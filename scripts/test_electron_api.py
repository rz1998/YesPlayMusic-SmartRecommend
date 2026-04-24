#!/usr/bin/env python3
"""
YesPlayMusic Electron 接口测试脚本
测试打包后应用的各个接口是否正常
"""
import subprocess
import sys
import time
import json
import signal
import os
from pathlib import Path
from typing import Optional

PROJECT = Path(__file__).parent.parent
EXE_PATH = PROJECT / "dist_electron/win-unpacked/YesPlayMusic.exe"


class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    END = "\033[0m"


def log(msg: str, color: str = ""):
    print(f"{color}{msg}{Colors.END}")


class ElectronTester:
    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.results = []

    def wait(self, seconds: int):
        time.sleep(seconds)

    def check(self, name: str, condition: bool, detail: str = ""):
        status = "✅ PASS" if condition else "❌ FAIL"
        color = Colors.GREEN if condition else Colors.RED
        log(f"  {status}: {name}", color)
        if detail:
            log(f"    → {detail}", Colors.BLUE)
        self.results.append({"name": name, "pass": condition, "detail": detail})
        return condition

    def run(self):
        log("=" * 60, Colors.YELLOW)
        log("YesPlayMusic Electron 接口测试", Colors.YELLOW)
        log("=" * 60, Colors.YELLOW)

        # ─── 1. 文件存在性检查 ───
        log("\n[1] 检查构建产物", Colors.YELLOW)
        asar = PROJECT / "dist_electron/win-unpacked/resources/app.asar"
        asar_unpacked = PROJECT / "dist_electron/win-unpacked/resources/app.asar.unpacked"
        portable_zip = PROJECT / "dist_electron/YesPlayMusic-0.5.22-win-portable.zip"
        nsis_exe = PROJECT / "dist_electron/YesPlayMusic-0.5.22-win-setup.exe"

        self.check("app.asar 存在", asar.exists(), str(asar))
        self.check("app.asar.unpacked 目录存在", asar_unpacked.exists())
        self.check("Portable zip 存在", portable_zip.exists(), f"{portable_zip.stat().st_size // 1024 // 1024}MB")
        self.check("NSIS 安装包存在", nsis_exe.exists(), f"{nsis_exe.stat().st_size // 1024 // 1024}MB")

        # ─── 2. asar 内容检查 ───
        log("\n[2] 检查 asar 内容", Colors.YELLOW)

        r = subprocess.run(
            ["node", "node_modules/.bin/asar", "list", str(asar)],
            capture_output=True, text=True, cwd=PROJECT
        )
        asar_content = r.stdout

        self.check("asar 可读取", r.returncode == 0)
        self.check("/background.js 在 asar 中", "/background.js" in asar_content)
        self.check("/index.html 在 asar 中", "/index.html" in asar_content)
        self.check("/server/ 在 asar 中", "/server/" in asar_content)
        self.check("/server/server.js 在 asar 中", "/server/server.js" in asar_content)
        self.check("/server/api/ 在 asar 中", "/server/api/" in asar_content)
        self.check("@neteaseapireborn/api 在 asar 中", "@neteaseapireborn" in asar_content)
        self.check("@neteaseapireborn/api/server.js 在 asar 中", "/node_modules/@neteaseapireborn/api/server.js" in asar_content)

        # 统计
        server_entries = asar_content.count("/server/")
        netease_entries = asar_content.count("@neteaseapireborn")
        self.check("server/ 条目数量 (>5000)", server_entries > 5000, f"{server_entries} 条")
        self.check("@neteaseapireborn 条目数量 (>700)", netease_entries > 700, f"{netease_entries} 条")

        # ─── 3. asar.unpacked 内容检查 ───
        log("\n[3] 检查 asar.unpacked 内容", Colors.YELLOW)

        asar_unpacked_list = list(asar_unpacked.iterdir())
        asar_unpacked_names = [p.name for p in asar_unpacked_list]

        self.check("asar.unpacked 有 server/ 目录", "server" in asar_unpacked_names,
                   f"目录: {asar_unpacked_names}")
        self.check("asar.unpacked 有 node_modules/ 目录", "node_modules" in asar_unpacked_names)

        if (asar_unpacked / "server").exists():
            server_files = list((asar_unpacked / "server").rglob("*"))
            self.check("asar.unpacked/server/ 有文件 (>1000)", len(server_files) > 1000, f"{len(server_files)} 个文件")

        # ─── 4. Express 路由分析 ───
        log("\n[4] 分析 Express 路由配置", Colors.YELLOW)

        with open(PROJECT / "src/background.js") as f:
            bg_src = f.read()

        checks = [
            ("/ → express.static(__dirname + '/')", "express.static(__dirname + '/')" in bg_src),
            ("/api → expressProxy('127.0.0.1:10754')", "expressProxy('http://127.0.0.1:10754')" in bg_src),
            ("监听端口 27232", "27232" in bg_src),
            ("startNeteaseMusicApi 调用", "startNeteaseMusicApi" in bg_src),
            ("startRecommenderServer 调用", "startRecommenderServer" in bg_src),
        ]
        for name, result in checks:
            self.check(name, result)

        # ─── 5. @neteaseapireborn/api 结构检查 ───
        log("\n[5] 检查 @neteaseapireborn/api 模块", Colors.YELLOW)

        api_module = PROJECT / "node_modules/@neteaseapireborn/api"
        checks = [
            ("server.js 存在", (api_module / "server.js").exists()),
            ("server.js 含 serveNcmApi", "serveNcmApi" in (api_module / "server.js").read_text()),
            ("server.js 含 getModulesDefinitions", "getModulesDefinitions" in (api_module / "server.js").read_text()),
            ("module/ 目录存在", (api_module / "module").exists()),
            ("module 数量 >50", len(list((api_module / "module").glob("*.js"))) > 50),
            ("package.json main 字段存在", "main" in json.loads((api_module / "package.json").read_text())),
        ]
        for name, result in checks:
            self.check(name, result)

        # ─── 6. 关键服务启动逻辑检查 ───
        log("\n[6] 检查服务启动逻辑 (background.js + services.js)", Colors.YELLOW)

        bg_src = (PROJECT / "src/background.js").read_text()
        sv_src = (PROJECT / "src/electron/services.js").read_text()
        combined = bg_src + "\n" + sv_src

        checks = [
            ("init() 中启动 NCM API", "this.neteaseMusicAPI = startNeteaseMusicApi()", bg_src),
            ("init() 中启动推荐服务器", "startRecommenderServer()", bg_src),
            ("init() 中创建 Express App", "this.createExpressApp()", bg_src),
            ("serveNcmApi 端口 10754", "port: 10754", sv_src),
            ("推荐服务器端口 3001", "PORT: '3001'", sv_src),
            ("NCM API 模块定义引用", "moduleDefs", sv_src),
            ("推荐服务器路径: app.asar.unpacked", "app.asar.unpacked", sv_src),
            ("推荐服务器 spawn cwd", "cwd: serverPath", sv_src),
        ]
        for name, cond, src in checks:
            self.check(name, cond in src)

        # ─── 7. 前端 API 请求配置检查 ───
        log("\n[7] 检查前端 API 请求配置", Colors.YELLOW)

        request_src = (PROJECT / "src/utils/request.js").read_text()
        checks = [
            ("生产环境 baseURL = /api", "VUE_APP_ELECTRON_API_URL" in request_src),
            ("开发环境 baseURL = localhost:10754", "VUE_APP_ELECTRON_API_URL_DEV" in request_src),
            ("Electron 环境判断", "IS_ELECTRON" in request_src),
        ]
        for name, result in checks:
            self.check(name, result)

        # ─── 8. 推荐服务器检查 ───
        log("\n[8] 检查推荐服务器 (server/)", Colors.YELLOW)

        server_dir = PROJECT / "server"
        checks = [
            ("server/server.js 存在", (server_dir / "server.js").exists()),
            ("server/api/recommend.js 存在", (server_dir / "api/recommend.js").exists()),
            ("server/api/profile.js 存在", (server_dir / "api/profile.js").exists()),
            ("server/api/events.js 存在", (server_dir / "api/events.js").exists()),
            ("server/package.json 存在", (server_dir / "package.json").exists()),
        ]
        for name, result in checks:
            self.check(name, result)

        # ─── 9. 构建脚本检查 ───
        log("\n[9] 检查构建脚本 patch_asar.py", Colors.YELLOW)

        patch_src = (PROJECT / "scripts/patch_asar.py").read_text()
        checks = [
            ("patch_asar 注入 server/ 到 asar", "server/" in patch_src and "copytree" in patch_src),
            ("patch_asar 复制到 asar.unpacked", "app.asar.unpacked" in patch_src),
            ("patch_asar 注入 node_modules", "Injected" in patch_src and "modules" in patch_src),
        ]
        for name, result in checks:
            self.check(name, result)

        # ─── 10. ncmModDef.js 检查 ───
        log("\n[10] 检查 NCM 模块定义 (ncmModDef.js)", Colors.YELLOW)

        ncm_mod = PROJECT / "src/ncmModDef.js"
        if ncm_mod.exists():
            ncm_src = ncm_mod.read_text()
            checks = [
                ("module.exports 数组", "module.exports = [" in ncm_src),
                ("identifier 字段", "identifier:" in ncm_src),
                ("route 字段", "route:" in ncm_src),
                ("@neteaseapireborn/api/module 引用", "@neteaseapireborn/api/module/" in ncm_src),
            ]
            for name, result in checks:
                self.check(name, result)
            # 统计模块数量
            count = ncm_src.count("identifier:")
            self.check("模块数量 >50", count > 50, f"{count} 个模块")
        else:
            self.check("ncmModDef.js 不存在", False)

        # ─── 总结 ───
        log("\n" + "=" * 60, Colors.YELLOW)
        passed = sum(1 for r in self.results if r["pass"])
        total = len(self.results)
        pct = passed / total * 100 if total > 0 else 0
        color = Colors.GREEN if pct >= 90 else Colors.YELLOW if pct >= 70 else Colors.RED
        log(f"测试结果: {passed}/{total} ({pct:.0f}%)", color)
        log("=" * 60, Colors.YELLOW)

        if pct < 100:
            log("\n失败项:", Colors.RED)
            for r in self.results:
                if not r["pass"]:
                    log(f"  ❌ {r['name']}: {r['detail']}", Colors.RED)

        return pct >= 90


if __name__ == "__main__":
    tester = ElectronTester()
    ok = tester.run()
    sys.exit(0 if ok else 1)
