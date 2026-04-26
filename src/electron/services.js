import clc from 'cli-color';
import checkAuthToken from '../utils/checkAuthToken';
import server from '@neteaseapireborn/api/server';
import { spawn } from 'child_process';
import path from 'path';
import { app } from 'electron';

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

export function startRecommenderServer() {
  if (recommenderServer) return; // Already running

  console.log(
    `${clc.greenBright(
      '[Recommender]'
    )} starting recommendation server on port 3001`
  );

  // Get the server directory path
  const isDev = !app.isPackaged;
  const serverPath = isDev
    ? path.join(process.cwd(), 'server')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'server');

  recommenderServer = spawn('node', ['server.js'], {
    cwd: serverPath,
    stdio: 'pipe',
    detached: false,
    env: { ...process.env, PORT: '3001' },
  });

  recommenderServer.stdout.on('data', data => {
    console.log(
      `${clc.greenBright('[Recommender]')} ${data.toString().trim()}`
    );
  });

  recommenderServer.stderr.on('data', data => {
    console.error(
      `${clc.greenBright('[Recommender]')} ${data.toString().trim()}`
    );
  });

  recommenderServer.on('error', err => {
    console.error(
      `${clc.greenBright('[Recommender]')} failed to start:`,
      err.message
    );
    recommenderServer = null;
  });

  recommenderServer.on('exit', code => {
    console.log(`${clc.greenBright('[Recommender]')} exited with code ${code}`);
    recommenderServer = null;
  });
}

export function stopRecommenderServer() {
  if (recommenderServer) {
    recommenderServer.kill();
    recommenderServer = null;
  }
}
