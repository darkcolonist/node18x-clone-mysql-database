const fs = require('fs')
    , { exec } = require('child_process')
    , moment = require('moment')
    , mysql = require('mysql2/promise')
    , input = require('readline-sync')
    , chalk = require('chalk');


const configPathDefault = './config.json';
const storagePath = './storage';
const dumpFile = 'dump.tmp';
const dumpFileName = `${storagePath}/${dumpFile}`;
const intervalMs = 500;
const pauseMs = 3000;

const sanitizeReplacement = "******";
const sanitizeKeys = [
  "user", "password"
];

let appseconds = new Date().getTime();

let configPathSpecified = input.question('enter absolute config file (./config.json): ');
let configPath = configPathSpecified || configPathDefault;

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
  terminate(`${configPath} not found.`, `make your own copy from ${configPathDefault}.example as seen in the root directory then configure it based on your system spec.`);
}

var loadedConfig = {};
try {
  loadedConfig = require(configPath);
  log(`${configPath} file loaded successfully`);
} catch (e) {
  terminate("malformed loadedConfig file in", configPath, e);
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

async function runQuery(dbConnectionConfig, statement){
  const ourConnection = await mysql.createConnection({
    host: dbConnectionConfig.host,
    user: dbConnectionConfig.user,
    password: dbConnectionConfig.password,
    database: dbConnectionConfig.database,
  });

  let result;

  try {
    const [rows] = await ourConnection.execute(statement);
    result = rows;
  } finally {
    await ourConnection.end();
  }

  return result;
}

async function verifyDbConnection(dbConnectionConfig) {
  const statement = `SELECT TRUE;`;

  try {
    await runQuery(dbConnectionConfig, statement);
    return true;
  } catch (error) {
    return false;
  }
}

async function getDbSize(dbConfig){
  const statement = `SELECT
    SUM(ROUND(((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024), 2)) AS "size"
    FROM INFORMATION_SCHEMA.TABLES
    WHERE
    TABLE_SCHEMA = "${dbConfig.database}";`;
  
  const rows = await runQuery(dbConfig, statement);

  if(rows.length > 0)
    return rows[0].size;
  else
    return 0;
}

async function getFileSizeInMB(filename){
  return new Promise((resolve, reject) => {
    fs.stat(filename, (err, stats) => {
      if(err)
        terminate(err);

      var fileSizeInBytes = stats.size;
      resolve(fileSizeInBytes / (1024 * 1024));
    });
  });
}

function sanitizeCommandForPublicDisplay(commandString){
  let sanitized = commandString;

  const toSanitize = [];

  sanitizeKeys.map((val, i) => {
    if(loadedConfig.source[val] && loadedConfig.source[val].trim())
      toSanitize.push(loadedConfig.source[val]);

    if (loadedConfig.target[val] && loadedConfig.target[val].trim())
      toSanitize.push(loadedConfig.target[val]);
  });

  toSanitize.map((val, i) => {
    sanitized = sanitized.replace(val, sanitizeReplacement);
  });

  return sanitized;
}

async function runCommand(command, intervalFunction) {
  // execSync(command); // blocking code
  
  let commandIntervalID;
  if(typeof intervalFunction === 'function'){
    commandIntervalID = setInterval(() => {
      intervalFunction();
    }, intervalMs);

    intervalFunction(); // run once ahead
  }

  return new Promise((resolve, reject) => { // non-blocking code
    log('executing command', chalk.green(sanitizeCommandForPublicDisplay(command)));
    exec(command, (error, stdout, stderr) => {
      if(error)
        terminate(error);
        
      if(stderr)
        terminate(stderr);

      setTimeout(() => {
        if (commandIntervalID) {
          clearInterval(commandIntervalID);
          process.stdout.write("\n");
        }

        log('done');
        resolve();
      }, pauseMs);
    });
  });
}

function printProgress(progress) {
  var timestamp = chalk.grey(moment().format("YYYY-MM-DD HH:mm:ss"));
  var heading = chalk.blue('stream');
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(`${timestamp} ${heading} ${progress}`);
}

async function mysqldumpRoutine(loadedConfig){
  const mysqlDumpParams = generateMysqlCommandParams(loadedConfig.source);

  // if (fs.existsSync(dumpFileName))
  //   fs.unlinkSync(dumpFileName);

  fs.writeFileSync(dumpFileName, '');

  const mysqlDumpExecCommand = `${loadedConfig.application.mysqldumpPath} ${mysqlDumpParams} > ${dumpFileName}`;
  log('exporting source db to dump file');
  
  var routineStart = new Date().getTime();
  async function mysqldumpCheckerFunction() {
    let elapsedTime = new Date().getTime();
    let elapsed = elapsedTime - routineStart;
    const fileSize = await getFileSizeInMB(dumpFileName);
    printProgress(`export file size: ${fileSize.toLocaleString()}MB ${chalk.blueBright.dim("+" + elapsed.toLocaleString() + "ms")}`);
  }

  await runCommand(mysqlDumpExecCommand, mysqldumpCheckerFunction);
  
  /**
   * code here to check the status of mysqldump, maybe display bytes
   * of the dump file so far...?
   */ 

  // , function () {
  //   log('DEBUG', 'mysqldump export is running.');
  //   // printProgress('mysql is still working...');
  // }
}

function beforeProcessConfirmation(){
  const confirmationMessage = `\n+-----------------------------------`
    + `\n| ` + chalk.bgYellow('WARNING: ABOUT TO MIGRATE')
    + `\n|  source: mysql://${loadedConfig.source.host}/${loadedConfig.source.database}`
    + `\n|  target: mysql://${loadedConfig.target.host}/${loadedConfig.target.database}`
    + `\n|  `
    + `\n|  ` + chalk.bgRed('*** ALL DATA IN TARGET WILL BE DELETED ***')
    + `\n|  `
    + `\n|  you need to explicitly type ${chalk.greenBright('YES')} to proceed`
    + `\n+-----------------------------------`;
  log(confirmationMessage);
  const processProceedConfirmationResult = input.question("> ",);
  if (processProceedConfirmationResult !== "YES") {
    terminate('process cancelled');
  }
}

async function mysqlImportRoutine(loadedConfig){
  const mysqlParams = generateMysqlCommandParams(loadedConfig.target);
  const mysqlExecCommand = `${loadedConfig.application.mysqlPath} ${mysqlParams} < ${dumpFileName}`;
  log('importing dump file to target db');

  var routineStart = new Date().getTime();
  async function mysqlImportCheckerFunction(){
    let elapsedTime = new Date().getTime();
    let elapsed = elapsedTime - routineStart;
    const dbSize = await getDbSize(loadedConfig.target);

    if(dbSize)
      printProgress(`target db size: ${dbSize.toLocaleString()}MB ${chalk.blueBright.dim("+"+elapsed.toLocaleString()+"ms")}`);
    else
      printProgress(`checking db size, please wait ${chalk.blueBright.dim("+" + elapsed.toLocaleString() + "ms")}`);
  }

  await runCommand(mysqlExecCommand, mysqlImportCheckerFunction);
}

async function verifyConnections() {
  printProgress('verifying connection to source...');
  const sourceResult = await verifyDbConnection(loadedConfig.source);
  printProgress('');
  if (!sourceResult)
  log(`verifying connection to source... ${chalk.redBright('FAILED')}`);
  else
  log(`verifying connection to source... ${chalk.greenBright('success')}`);
  
  printProgress('verifying connection to target...');
  const targetResult = await verifyDbConnection(loadedConfig.target);
  printProgress('');
  if (!targetResult)
    log(`verifying connection to target... ${chalk.redBright('FAILED')}`);
  else
    log(`verifying connection to target... ${chalk.greenBright('success')}`);

  if(!sourceResult || !targetResult)
    terminate('unable to proceed');
}

async function main() {
  try {
    await verifyConnections();
    beforeProcessConfirmation();
    log('checking storage directory permissions');

    if(!checkStoragePermissions())
      terminate(`no write permissions for ${storagePath}`);

    await mysqldumpRoutine(loadedConfig);
    await mysqlImportRoutine(loadedConfig);

    log('cleaning up')
    await new Promise(r => setTimeout(r, pauseMs));

    fs.writeFileSync(dumpFileName, '');

    terminate('migration completed');
  } catch (error) {
    // terminate(error);
    terminate(error.stack);
    // log(chalk.redBright(error.stack));
    // process.exit(1);
  }
}

main();