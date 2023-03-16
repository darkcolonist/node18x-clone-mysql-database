const mysql = require('mysql2/promise');

const sourceConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'db_nmsitd_dashboard_trello_dev_2023_02_20',
  port: 3306,
};

const targetConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: '2023tester',
  port: 3306,
};

async function main() {
  try {
    // Connect to source database
    const sourceConnection = await mysql.createConnection(sourceConfig);

    // Find Target Database
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
    }

    // Migrate data from source tables to target tables
    for (const tableName of tableNames) {
      await targetConnection.execute(`INSERT INTO ${targetConfig.database}.${tableName} SELECT * FROM ${sourceConfig.database}.${tableName}`);
    }

    targetConnection.execute("SET foreign_key_checks = 1");

    console.log('Database copied successfully');

    // Close connections
    await sourceConnection.end();
    await targetConnection.end();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
