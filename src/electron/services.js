import clc from 'cli-color';
import checkAuthToken from '../utils/checkAuthToken';
import server from '@neteaseapireborn/api/server';
import { createServer } from 'http';
import path from 'path';
import { app } from 'electron';
// server.js uses CommonJS (require), loaded via absolute path to bypass webpack externals
// __dirname in packaged app is the directory of background.js = resources/app/
// server.js is at resources/app/server/server.js
const serverPath = path.join(__dirname, 'server', 'server.js');
console.log(`[Recommender] serverPath=${serverPath}`);
// Use Module.createRequire to bypass webpack's require wrapper
// webpack wraps require() and misroutes dynamic requires to wrong modules
const Module = require('module');
const nativeRequire = Module.createRequire(__filename);
const serverApp = nativeRequire(serverPath);
console.log(
  `[Recommender] serverApp type=${typeof serverApp}, keys=${
    serverApp ? Object.keys(serverApp).join(',') : 'null'
  }`
);

export async function startNeteaseMusicApi() {
  // Let user know that the service is starting
  console.log(
    `${clc.redBright('[NetEase API]')} initiating NCM API on port 10754`
  );

  // Load the NCM API.
  try {
    await server.serveNcmApi({
      port: 10754,
      moduleDefs: require('../ncmModDef'),
    });
    console.log(
      `${clc.greenBright('[NetEase API]')} NCM API started successfully`
    );
  } catch (err) {
    console.error(
      `${clc.redBright('[NetEase API]')} failed to start:`,
      err.message
    );
    console.error(`${clc.redBright('[NetEase API]')} Full error:`, err);
  }
}

let recommenderServer = null;

/**
 * Start the recommendation server as an HTTP server in the main process.
 * serverApp (an Express app) is imported statically and started here.
 */
export async function startRecommenderServer() {
  if (recommenderServer) return; // Already running

  console.log(
    `${clc.greenBright('[Recommender]')} starting HTTP server on port 3001`
  );

  try {
    // Wait for DB initialization BEFORE starting the server
    if (serverApp.dbReady) {
      console.log(`${clc.greenBright('[Recommender]')} waiting for DB init...`);
      await serverApp.dbReady;
      console.log(
        `${clc.greenBright('[Recommender]')} DB ready, starting HTTP server`
      );
    }

    // serverApp is the Express app imported statically above
    // server.js does NOT auto-start when imported (require.main !== module check)
    recommenderServer = createServer(serverApp);
    recommenderServer.listen(3001, '127.0.0.1', () => {
      console.log(
        `${clc.greenBright('[Recommender]')} listening on 127.0.0.1:3001`
      );
    });
    recommenderServer.on('error', err => {
      console.error(
        `${clc.greenBright('[Recommender]')} listen error:`,
        err.message
      );
      recommenderServer = null;
    });
  } catch (err) {
    console.error(`${clc.greenBright('[Recommender]')} error:`, err.message);
    console.error(`${clc.greenBright('[Recommender]')} stack:`, err.stack);
  }
}

export function stopRecommenderServer() {
  if (recommenderServer) {
    recommenderServer.close();
    recommenderServer = null;
  }
}
