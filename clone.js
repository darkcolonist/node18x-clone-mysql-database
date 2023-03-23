const fs = require('fs')
    , { execSync } = require('child_process')
    , moment = require('moment')
    , chalk = require('chalk');

    
const configPath = './config.json';
const storagePath = './storage';

let appseconds = new Date().getTime();
function log(...message) {
  var curseconds = new Date().getTime();
  var dur = curseconds - appseconds;
  appseconds = new Date().getTime();
  var timestamp = chalk.grey(moment().format("YYYY-MM-DD HH:mm:ss"));
  console.log(timestamp, ...message, chalk.blueBright.dim("+" + dur.toLocaleString() + "ms"));
}

function terminate(...message) {
  var curseconds = new Date().getTime();
  var dur = curseconds - appseconds;
  appseconds = new Date().getTime();
  var timestamp = chalk.grey(moment().format("YYYY-MM-DD HH:mm:ss"));
  console.log(timestamp, chalk.red(...message), chalk.yellow.dim("+" + dur.toLocaleString() + "ms"));
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  terminate(`${configPath} not found.`, `make your own copy from ${configPath}.example then configure it based on your system spec.`);
}

var sourceConfig;
var targetConfig;
var loadedConfig = {};
try {
  loadedConfig = require(configPath);

  sourceConfig = loadedConfig.source;
  targetConfig = loadedConfig.target;
  log(`${configPath} file loaded successfully`);
} catch (e) {
  terminate("malformed loadedConfig file in", args.file, e);
}

// terminate('DEV: end');

function generateMysqlCommandParams(loadedConfig) {
  return [
    { "arg":"", "key":"database" }
    , { "arg":"-h", "key":"host" }
    , { "arg":"-u", "key":"user" }
    , { "arg":"-p", "key":"password" }
    , { "arg":"-P", "key":"port" }
  ].map((value, id) => {
    if(loadedConfig[value.key])
      return `${value.arg}"${loadedConfig[value.key]}"`;
    // else
    //   terminate(`${value.key} not found in source config`);
  }).join(" ");
}

function checkStoragePermissions(params) {
  try {
    fs.accessSync(storagePath, fs.constants.W_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function runCommand(command) {
  log('executing command', chalk.greenBright(command));
  const output = execSync(command);
  log('done', output.toString());
}

async function main() {
  try {
    log('checking storage directory permissions');

    if(!checkStoragePermissions())
      terminate(`no write permissions for ${storagePath}`);

    const mysqlDumpParams = generateMysqlCommandParams(sourceConfig);
    const mysqlDumpExecCommand = `${loadedConfig.application.mysqldumpPath} ${mysqlDumpParams} > ./storage/dump.tmp`;
    log('exporting source db to dump file');
    runCommand(mysqlDumpExecCommand);
    
    const mysqlParams = generateMysqlCommandParams(targetConfig);
    const mysqlExecCommand = `${loadedConfig.application.mysqlPath} ${mysqlParams} < ./storage/dump.tmp`;
    log('importing dump file to target db');
    runCommand(mysqlExecCommand);
    terminate('migration completed');
  } catch (error) {
    // terminate(error);
    terminate(error.stack);
    // log(chalk.redBright(error.stack));
    // process.exit(1);
  }
}

main();
