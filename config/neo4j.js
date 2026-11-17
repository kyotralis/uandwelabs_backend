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

    // Ensure unique constraints on User email, User id, & OtpVerification email
    const session = getSession();
    try {
      await session.run(`
        CREATE CONSTRAINT user_email_unique IF NOT EXISTS
        FOR (u:User) REQUIRE u.email IS UNIQUE
      `);
      await session.run(`
        CREATE CONSTRAINT user_id_unique IF NOT EXISTS
        FOR (u:User) REQUIRE u.id IS UNIQUE
      `);
      await session.run(`
        CREATE CONSTRAINT otp_email_unique IF NOT EXISTS
        FOR (o:OtpVerification) REQUIRE o.email IS UNIQUE
      `);
      console.log('[Neo4j] Schema constraints "user_email_unique", "user_id_unique" & "otp_email_unique" ensured');

      // Migrate any existing users with non-conforming IDs (e.g. UUIDs) to user_uandwelabs_user<N>
      try {
        const unmigrated = await session.run(`
          MATCH (u:User)
          WHERE u.id IS NULL OR NOT u.id STARTS WITH 'user_uandwelabs_user'
          RETURN u.email AS email, u.id AS oldId
          ORDER BY u.createdAt ASC
        `);
        if (unmigrated && unmigrated.records.length > 0) {
          for (let i = 0; i < unmigrated.records.length; i++) {
            const email = unmigrated.records[i].get('email');
            const newId = `user_uandwelabs_user${i + 1}`;
            await session.run(`
              MATCH (u:User { email: $email })
              SET u.id = $newId
            `, { email, newId });
            console.log(`[Neo4j Migration] Migrated user ${email} to ${newId}`);
          }
          await session.run(`
            MERGE (s:UserSequence { id: 'user_id_sequence' })
            SET s.counter = $count
          `, { count: unmigrated.records.length });
        }
      } catch (migErr) {
        console.warn('[Neo4j Migration] Optional migration notice:', migErr.message);
      }
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
