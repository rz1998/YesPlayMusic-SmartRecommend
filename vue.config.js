const webpack = require('webpack');
const path = require('path');
function resolve(dir) {
  return path.join(__dirname, dir);
}

module.exports = {
  // 生产环境打包不输出 map
  productionSourceMap: false,
  devServer: {
    disableHostCheck: true,
    port: process.env.DEV_SERVER_PORT || 8080,
    proxy: {
      '^/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        pathRewrite: {
          '^/api': '/',
        },
      },
    },
  },
  pwa: {
    name: 'YesPlayMusic',
    iconPaths: {
      favicon32: 'img/icons/favicon-32x32.png',
    },
    themeColor: '#ffffff00',
    manifestOptions: {
      background_color: '#335eea',
    },
    // workboxOptions: {
    //   swSrc: "dev/sw.js",
    // },
  },
  pages: {
    index: {
      entry: 'src/main.js',
      template: 'public/index.html',
      filename: 'index.html',
      title: 'YesPlayMusic',
      chunks: ['main', 'chunk-vendors', 'chunk-common', 'index'],
    },
  },
  chainWebpack(config) {
    config.module.rules.delete('svg');
    config.module.rule('svg').exclude.add(resolve('src/assets/icons')).end();
    config.module
      .rule('icons')
      .test(/\.svg$/)
      .include.add(resolve('src/assets/icons'))
      .end()
      .use('svg-sprite-loader')
      .loader('svg-sprite-loader')
      .options({
        symbolId: 'icon-[name]',
      })
      .end();
    config.module
      .rule('napi')
      .test(/\.node$/)
      .use('node-loader')
      .loader('node-loader')
      .end();

    config.module
      .rule('webpack4_es_fallback')
      .test(/\.js$/)
      .include.add(/node_modules/)
      .end()
      .use('esbuild-loader')
      .loader('esbuild-loader')
      .options({ target: 'es2015', format: "cjs" })
      .end();

    // LimitChunkCountPlugin 可以通过合并块来对块进行后期处理。用以解决 chunk 包太多的问题
    config.plugin('chunkPlugin').use(webpack.optimize.LimitChunkCountPlugin, [
      {
        maxChunks: 3,
        minChunkSize: 10_000,
      },
    ]);
  },
  // 添加插件的配置
  pluginOptions: {
    // electron-builder的配置文件
    electronBuilder: {
      nodeIntegration: true,
      externals: ['@unblockneteasemusic/rust-napi'],
      builderOptions: {
        productName: 'YesPlayMusic',
        copyright: 'Copyright © YesPlayMusic',
        // version 从环境变量 ARTIFACT_VERSION 读取（CI自动设置，去掉v前缀）
        extraMetadata: {
          version: process.env.ARTIFACT_VERSION ? process.env.ARTIFACT_VERSION.replace(/^v/, '') : require('./package.json').version,
        },
        // compression: "maximum", // 机器好的可以打开，配置压缩，开启后会让 .AppImage 格式的客户端启动缓慢
        asar: true,
        publish: [
          {
            provider: 'github',
            owner: 'qier222',
            repo: 'YesPlayMusic',
            vPrefixedTagName: true,
            releaseType: 'draft',
          },
        ],

        directories: {
          output: 'dist_electron',
        },
        mac: {
          target: [
            {
              target: 'dmg',
              arch: ['x64', 'arm64', 'universal'],
            },
          ],
          artifactName: '${productName}-${os}-${version}-${arch}.${ext}',
          category: 'public.app-category.music',
          darkModeSupport: true,
        },
        win: {
          target: [
            {
              target: 'portable',
              arch: ['x64'],
            },
            {
              target: 'nsis',
              arch: ['x64'],
            },
          ],
          publisherName: 'YesPlayMusic',
          icon: 'build/icons/icon.ico',
          publish: ['github'],
        },
        linux: {
          target: [
            {
              target: 'AppImage',
              arch: ['x64'],
            },
            {
              target: 'tar.gz',
              arch: ['x64', 'arm64'],
            },
            {
              target: 'deb',
              arch: ['x64', 'armv7l', 'arm64'],
            },
            {
              target: 'rpm',
              arch: ['x64'],
            },
            {
              target: 'snap',
              arch: ['x64'],
            },
          ],
          category: 'Music',
          icon: './build/icon.icns',
        },
        dmg: {
          icon: 'build/icons/icon.icns',
        },
        nsis: {
          oneClick: true,
          perMachine: true,
          deleteAppDataOnUninstall: true,
        },
      },
      // 主线程的配置文件
      chainWebpackMainProcess: config => {
        config.plugin('define').tap(args => {
          args[0]['IS_ELECTRON'] = true;
          return args;
        });
        config.resolve.alias.set(
          'jsbi',
          path.join(__dirname, 'node_modules/jsbi/dist/jsbi-cjs.js')
        );

        config.module
          .rule('webpack4_es_fallback')
          .test(/\.js$/)
          .include.add(/node_modules/)
          .end()
          .use('esbuild-loader')
          .loader('esbuild-loader')
          .options({ target: 'es2015', format: "cjs" })
          .end();
      },
      // 渲染线程的配置文件
      chainWebpackRendererProcess: config => {
        // 渲染线程的一些其他配置
        // Chain webpack config for electron renderer process only
        // The following example will set IS_ELECTRON to true in your app
        config.plugin('define').tap(args => {
          args[0]['IS_ELECTRON'] = true;
          return args;
        });
      },
      // 主入口文件
      // mainProcessFile: 'src/main.js',
      // mainProcessArgs: []
      // afterPack: 在 electron-builder 打包后注入缺失的 node_modules
      afterPack: async ({ appOutDir }) => {
        const fs = require('fs');
        const fsp = require('fs').promises;
        const path = require('path');
        const os = require('os');
        const { execSync } = require('child_process');
        const asar = require('asar');

        const asarPath = path.join(appOutDir, 'resources', 'app.asar');
        // 使用 os.tmpdir() 替代 /tmp，兼容 Windows
        const extractDir = path.join(os.tmpdir(), `ypm-asar-${Date.now()}`);
        const nmSrc = path.join(__dirname, 'node_modules');

        // Modules that MUST be included
        const REQUIRED = [
          '@neteaseapireborn/api',
          '@unblockneteasemusic/server',
          '@unblockneteasemusic/rust-napi-win32-x64-msvc',
          'express', 'ws', 'axios', 'cli-color', 'compression',
          'express-http-proxy', 'electron-store', 'electron-log',
          'electron-updater', 'electron-devtools-installer', 'body-parser',
          'ip', 'uuid', 'crypto-js', 'dotenv', 'express-fileupload',
          'md5', 'music-metadata', 'node-forge', 'pac-proxy-agent',
          'qrcode', 'safe-decode-uri-component', 'tunnel', 'xml2js', 'yargs',
        ];

        function getAllDeps(mod, seen = new Set()) {
          if (seen.has(mod)) return seen;
          const modPath = path.join(nmSrc, mod);
          if (!fs.existsSync(modPath)) return seen;
          seen.add(mod);
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(modPath, 'package.json'), 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
            for (const d of Object.keys(deps)) {
              if (!d.startsWith('@types') && !['jest', 'eslint', 'webpack'].includes(d)) {
                getAllDeps(d, seen);
              }
            }
          } catch {}
          return seen;
        }

        const allMods = new Set();
        for (const m of REQUIRED) getAllDeps(m, allMods);

        console.log(`[afterPack] Extracting asar to ${extractDir}...`);
        fs.mkdirSync(extractDir, { recursive: true });
        await asar.extract(asarPath, extractDir);

        const nmDest = path.join(extractDir, 'node_modules');
        fs.mkdirSync(nmDest, { recursive: true });

        // 跨平台复制函数：优先用 fs.promises.cp (Node 16+)，降级用 shell cp
        async function copyDir(src, dest) {
          try {
            await fsp.cp(src, dest, { recursive: true, force: true });
          } catch {
            // Node < 16.7: 用 shell 命令复制
            execSync(`cp -r "${src}" "${dest}"`, { stdio: 'ignore' });
          }
        }

        for (const mod of [...allMods].sort()) {
          const src = path.join(nmSrc, mod);
          const dest = path.join(nmDest, mod);
          if (fs.existsSync(src) && fs.lstatSync(src).isDirectory()) {
            if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
            await copyDir(src, dest);
            console.log(`  + ${mod}`);
          }
        }

        // Also copy @unblockneteasemusic sub-packages
        const unblockSrc = path.join(nmSrc, '@unblockneteasemusic');
        const unblockDest = path.join(nmDest, '@unblockneteasemusic');
        if (fs.existsSync(unblockSrc)) {
          fs.mkdirSync(unblockDest, { recursive: true });
          for (const sub of fs.readdirSync(unblockSrc)) {
            const s = path.join(unblockSrc, sub);
            const d = path.join(unblockDest, sub);
            if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
            await copyDir(s, d);
          }
          console.log('  + @unblockneteasemusic/*');
        }

        console.log(`[afterPack] Repacking asar (${allMods.size} modules added)...`);
        if (fs.existsSync(asarPath)) fs.unlinkSync(asarPath);
        await asar.createPackage(extractDir, asarPath);
        fs.rmSync(extractDir, { recursive: true, force: true });
        console.log('[afterPack] Done!');
      },
    },
  },
};
