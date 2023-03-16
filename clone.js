const mysql = require('mysql2/promise')
    , fs = require('fs')
    , moment = require('moment')
    , chalk = require('chalk');

const configPath = './config.json';
const config = {};

let appseconds = new Date().getTime();
function log(...message) {
  var curseconds = new Date().getTime();
  var dur = curseconds - appseconds;
  appseconds = new Date().getTime();
  var timestamp = chalk.grey(moment().format("YYYY-MM-DD HH:mm:ss"));
  console.log(timestamp, ...message, chalk.blueBright.dim("+" + dur + "ms"));
}

function terminate(...message) {
  var curseconds = new Date().getTime();
  var dur = curseconds - appseconds;
  appseconds = new Date().getTime();
  var timestamp = chalk.grey(moment().format("YYYY-MM-DD HH:mm:ss"));
  console.log(timestamp, chalk.red(...message), chalk.yellow.dim("+" + dur + "ms"));
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

async function main() {
  try {
    // Connect to source database
    log("attempting to connect to source");
    const sourceConnection = await mysql.createConnection(sourceConfig);

    // Find Target Database
    log("attempting to connect to target");
    const targetConnection = await mysql.createConnection({
      host: targetConfig.host,
      user: targetConfig.user,
      password: targetConfig.password,
      database: targetConfig.database,
    });
    
    targetConnection.execute("SET foreign_key_checks = 0");

    // Get source table names
    const [tableRows] = await sourceConnection.execute('SHOW TABLES');
    const tableNames = tableRows.map(row => row[`Tables_in_${sourceConfig.database}`]);

    // Create target tables from source tables
    for (const tableName of tableNames) {
      const [tableDefinitionRows] = await sourceConnection.execute(`SHOW CREATE TABLE ${tableName}`);
      const tableDefinition = tableDefinitionRows[0]['Create Table'];
      await targetConnection.execute(tableDefinition);
      log(chalk.gray(`created table ${tableName} in target successfully`));
    }

    // Migrate data from source tables to target tables
    for (const tableName of tableNames) {
      await targetConnection.execute(`INSERT INTO ${targetConfig.database}.${tableName} SELECT * FROM ${sourceConfig.database}.${tableName}`);
      log(chalk.gray(`transferred data to table ${tableName} in target successfully`));
    }

    targetConnection.execute("SET foreign_key_checks = 1");

    log(chalk.green('Database copied successfully'));

    // Close connections
    await sourceConnection.end();
    await targetConnection.end();
  } catch (error) {
    terminate(error);
    process.exit(1);
  }
}

main();
