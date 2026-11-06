import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.NEO4J_URI || 'neo4j+s://40381be2.databases.neo4j.io';
const initialUser = process.env.NEO4J_USERNAME || process.env.NEO4J_USER || '40381be2';
const password = process.env.NEO4J_PASSWORD || 'qwceHnb8Wyn6GW51r5X5tyGHg81g9HjF5hSa_kgB2Vw';
const database = process.env.NEO4J_DATABASE || '40381be2';

let driver = null;

function createDriver(authUser) {
  return neo4j.driver(
    uri,
    neo4j.auth.basic(authUser, password),
    {
      disableLosslessIntegers: true, // Auto-convert Neo4j Integers to standard JS numbers
      maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 10000,
    }
  );
}

// Initialize driver
driver = createDriver(initialUser);

/**
 * Verify connectivity and setup database constraints
 */
export async function initNeo4j() {
  try {
    let serverInfo;
    try {
      serverInfo = await driver.getServerInfo();
      console.log(`[Neo4j] Connected to server: ${serverInfo.address} (${serverInfo.agent})`);
    } catch (authErr) {
      // If initialUser failed and it wasn't 'neo4j', automatically try default 'neo4j' user
      if (initialUser !== 'neo4j') {
        console.log(`[Neo4j] Attempting connection with default username "neo4j"...`);
        try {
          await driver.close().catch(() => {});
          driver = createDriver('neo4j');
          serverInfo = await driver.getServerInfo();
          console.log(`[Neo4j] Successfully connected to server with "neo4j": ${serverInfo.address}`);
        } catch (retryErr) {
          throw authErr;
        }
      } else {
        throw authErr;
      }
    }

    // Ensure unique constraint on User email
    const session = getSession();
    try {
      await session.run(`
        CREATE CONSTRAINT user_email_unique IF NOT EXISTS
        FOR (u:User) REQUIRE u.email IS UNIQUE
      `);
      console.log('[Neo4j] Schema constraint "user_email_unique" ensured');
    } finally {
      await session.close();
    }

    return true;
  } catch (error) {
    console.warn(`[Neo4j] Warning: Could not connect to Neo4j at ${uri}: ${error.message}`);
    console.warn('[Neo4j] Verify your database status in the Neo4j Aura console (is it in "Running" state?).');
    return false;
  }
}

/**
 * Get a Neo4j session
 */
export function getSession(mode = neo4j.session.WRITE) {
  if (!driver) {
    throw new Error('Neo4j driver is not initialized');
  }
  return driver.session({
    defaultAccessMode: mode,
    database: database || undefined,
  });
}

/**
 * Execute a read Cypher query
 */
export async function readQuery(cypher, params = {}) {
  const session = getSession(neo4j.session.READ);
  try {
    const result = await session.executeRead((tx) => tx.run(cypher, params));
    return result.records;
  } finally {
    await session.close();
  }
}

/**
 * Execute a write Cypher query
 */
export async function writeQuery(cypher, params = {}) {
  const session = getSession(neo4j.session.WRITE);
  try {
    const result = await session.executeWrite((tx) => tx.run(cypher, params));
    return result.records;
  } finally {
    await session.close();
  }
}

/**
 * Gracefully close the driver
 */
export async function closeNeo4j() {
  if (driver) {
    await driver.close();
    console.log('[Neo4j] Driver connection closed');
  }
}

export default driver;
