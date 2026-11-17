import bcrypt from 'bcryptjs';
import { readQuery, writeQuery } from '../config/neo4j.js';

export const UserModel = {
  /**
   * Generates the next sequential user ID in format: user_uandwelabs_user<N>
   * Checks existing User nodes and maintains an atomic counter in UserSequence.
   */
  async getNextUserId() {
    try {
      const checkCypher = `
        MATCH (u:User)
        RETURN count(u) AS totalCount, collect(u.id) AS existingIds
      `;
      const records = await readQuery(checkCypher);
      let maxNum = 0;
      if (records && records.length > 0) {
        const total = Number(records[0].get('totalCount')) || 0;
        maxNum = total;
        const ids = records[0].get('existingIds') || [];
        for (const id of ids) {
          if (typeof id === 'string') {
            const match = id.match(/user_uandwelabs_user(\d+)/i);
            if (match) {
              const n = parseInt(match[1], 10);
              if (n > maxNum) maxNum = n;
            }
          }
        }
      }

      const nextNum = maxNum + 1;
      const seqCypher = `
        MERGE (s:UserSequence { id: 'user_id_sequence' })
        ON CREATE SET s.counter = $nextNum
        ON MATCH SET s.counter = CASE 
          WHEN coalesce(s.counter, 0) < $nextNum THEN $nextNum 
          ELSE s.counter + 1 
        END
        RETURN s.counter AS finalNum
      `;
      const seqRecords = await writeQuery(seqCypher, { nextNum });
      const finalNum = seqRecords?.[0]?.get('finalNum') || nextNum;
      return `user_uandwelabs_user${finalNum}`;
    } catch (err) {
      console.warn('[UserModel] getNextUserId error, using fallback count:', err.message);
      try {
        const countRecords = await readQuery('MATCH (u:User) RETURN count(u) AS c');
        const c = countRecords && countRecords.length > 0 ? Number(countRecords[0].get('c')) : 0;
        return `user_uandwelabs_user${c + 1}`;
      } catch {
        return `user_uandwelabs_user1`;
      }
    }
  },

  /**
   * Find a user node by email
   */
  async findByEmail(email) {
    const normalizedEmail = email.trim().toLowerCase();
    const cypher = `
      MATCH (u:User { email: $email })
      RETURN u {
        .id,
        .email,
        .name,
        .password,
        .role,
        .selectedProduct,
        .createdAt,
        .updatedAt
      } AS user
      LIMIT 1
    `;

    const records = await readQuery(cypher, { email: normalizedEmail });
    if (!records || records.length === 0) return null;
    return records[0].get('user');
  },

  /**
   * Find a user node by unique ID
   */
  async findById(id) {
    const cypher = `
      MATCH (u:User { id: $id })
      RETURN u {
        .id,
        .email,
        .name,
        .role,
        .selectedProduct,
        .createdAt,
        .updatedAt
      } AS user
      LIMIT 1
    `;

    const records = await readQuery(cypher, { id });
    if (!records || records.length === 0) return null;
    return records[0].get('user');
  },

  /**
   * Create a new user node with hashed password
   */
  async create({ email, password, name, role = 'member', selectedProduct = 'ananda' }) {
    const normalizedEmail = email.trim().toLowerCase();
    const id = await this.getNextUserId();
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const now = new Date().toISOString();

    const cypher = `
      CREATE (u:User {
        id: $id,
        email: $email,
        name: $name,
        password: $password,
        role: $role,
        selectedProduct: $selectedProduct,
        lastLoginProduct: $selectedProduct,
        lastLoginAt: $now,
        lastLoginMethod: 'password',
        totalLogins: 1,
        commercialLogins: CASE WHEN $selectedProduct = 'ananda' OR $selectedProduct = 'commercial' THEN 1 ELSE 0 END,
        residencyLogins: CASE WHEN $selectedProduct = 'ananda-residential' OR $selectedProduct = 'residential' THEN 1 ELSE 0 END,
        daraLogins: CASE WHEN $selectedProduct = 'dara' THEN 1 ELSE 0 END,
        auraLogins: CASE WHEN $selectedProduct = 'aura' THEN 1 ELSE 0 END,
        createdAt: $now,
        updatedAt: $now
      })
      MERGE (s:SystemAnalytics { id: 'workspace_login_stats' })
      ON CREATE SET
        s.totalLogins = 1,
        s.commercialLogins = CASE WHEN $selectedProduct = 'ananda' OR $selectedProduct = 'commercial' THEN 1 ELSE 0 END,
        s.residencyLogins = CASE WHEN $selectedProduct = 'ananda-residential' OR $selectedProduct = 'residential' THEN 1 ELSE 0 END,
        s.daraLogins = CASE WHEN $selectedProduct = 'dara' THEN 1 ELSE 0 END,
        s.auraLogins = CASE WHEN $selectedProduct = 'aura' THEN 1 ELSE 0 END,
        s.createdAt = $now,
        s.updatedAt = $now
      ON MATCH SET
        s.totalLogins = coalesce(s.totalLogins, 0) + 1,
        s.commercialLogins = coalesce(s.commercialLogins, 0) + (CASE WHEN $selectedProduct = 'ananda' OR $selectedProduct = 'commercial' THEN 1 ELSE 0 END),
        s.residencyLogins = coalesce(s.residencyLogins, 0) + (CASE WHEN $selectedProduct = 'ananda-residential' OR $selectedProduct = 'residential' THEN 1 ELSE 0 END),
        s.daraLogins = coalesce(s.daraLogins, 0) + (CASE WHEN $selectedProduct = 'dara' THEN 1 ELSE 0 END),
        s.auraLogins = coalesce(s.auraLogins, 0) + (CASE WHEN $selectedProduct = 'aura' THEN 1 ELSE 0 END),
        s.updatedAt = $now
      RETURN u {
        .id,
        .email,
        .name,
        .role,
        .selectedProduct,
        .totalLogins,
        .commercialLogins,
        .residencyLogins,
        .daraLogins,
        .auraLogins,
        .createdAt,
        .updatedAt
      } AS user
    `;

    const records = await writeQuery(cypher, {
      id,
      email: normalizedEmail,
      name: name || normalizedEmail.split('@')[0],
      password: hashedPassword,
      role,
      selectedProduct,
      now,
    });

    return records[0].get('user');
  },

  /**
   * Record a login event: increment total and per-product login counts
   * and update global stats in Neo4j
   */
  async recordLogin(userId, selectedProduct = 'ananda', authMethod = 'password') {
    if (!userId) return null;
    const now = new Date().toISOString();
    const prod = (selectedProduct || 'ananda').toLowerCase();

    const cypher = `
      MATCH (u:User { id: $userId })
      SET u.selectedProduct = $prod,
          u.lastLoginProduct = $prod,
          u.lastLoginAt = $now,
          u.lastLoginMethod = $authMethod,
          u.totalLogins = coalesce(u.totalLogins, 0) + 1,
          u.commercialLogins = coalesce(u.commercialLogins, 0) + (CASE WHEN $prod = 'ananda' OR $prod = 'commercial' THEN 1 ELSE 0 END),
          u.residencyLogins = coalesce(u.residencyLogins, 0) + (CASE WHEN $prod = 'ananda-residential' OR $prod = 'residential' THEN 1 ELSE 0 END),
          u.daraLogins = coalesce(u.daraLogins, 0) + (CASE WHEN $prod = 'dara' THEN 1 ELSE 0 END),
          u.auraLogins = coalesce(u.auraLogins, 0) + (CASE WHEN $prod = 'aura' THEN 1 ELSE 0 END),
          u.updatedAt = $now

      MERGE (s:SystemAnalytics { id: 'workspace_login_stats' })
      ON CREATE SET
        s.totalLogins = 0,
        s.commercialLogins = 0,
        s.residencyLogins = 0,
        s.daraLogins = 0,
        s.auraLogins = 0,
        s.createdAt = $now
      SET
        s.totalLogins = coalesce(s.totalLogins, 0) + 1,
        s.commercialLogins = coalesce(s.commercialLogins, 0) + (CASE WHEN $prod = 'ananda' OR $prod = 'commercial' THEN 1 ELSE 0 END),
        s.residencyLogins = coalesce(s.residencyLogins, 0) + (CASE WHEN $prod = 'ananda-residential' OR $prod = 'residential' THEN 1 ELSE 0 END),
        s.daraLogins = coalesce(s.daraLogins, 0) + (CASE WHEN $prod = 'dara' THEN 1 ELSE 0 END),
        s.auraLogins = coalesce(s.auraLogins, 0) + (CASE WHEN $prod = 'aura' THEN 1 ELSE 0 END),
        s.updatedAt = $now

      RETURN u {
        .id,
        .email,
        .name,
        .role,
        .selectedProduct,
        .totalLogins,
        .commercialLogins,
        .residencyLogins,
        .daraLogins,
        .auraLogins,
        .lastLoginAt,
        .createdAt,
        .updatedAt
      } AS user
    `;

    try {
      const records = await writeQuery(cypher, { userId, prod, authMethod, now });
      if (records && records.length > 0) {
        return records[0].get('user');
      }
    } catch (err) {
      console.warn('[User recordLogin Warning]:', err.message);
    }
    return null;
  },

  /**
   * Retrieve aggregated workspace login statistics
   */
  async getWorkspaceStats() {
    const cypher = `
      MATCH (s:SystemAnalytics { id: 'workspace_login_stats' })
      RETURN s {
        .totalLogins,
        .commercialLogins,
        .residencyLogins,
        .daraLogins,
        .auraLogins,
        .updatedAt
      } AS stats
      LIMIT 1
    `;
    try {
      const records = await readQuery(cypher);
      if (records && records.length > 0) {
        return records[0].get('stats');
      }
    } catch (err) {
      console.warn('[getWorkspaceStats Warning]:', err.message);
    }
    return {
      totalLogins: 0,
      commercialLogins: 0,
      residencyLogins: 0,
      daraLogins: 0,
      auraLogins: 0,
    };
  },

  /**
   * Update user's last selected product workspace
   */
  async updateSelectedProduct(userId, selectedProduct) {
    return this.recordLogin(userId, selectedProduct, 'switch');
  },

  /**
   * Compare plain password with stored bcrypt hash
   */
  async comparePassword(candidatePassword, hashedPassword) {
    return bcrypt.compare(candidatePassword, hashedPassword);
  },

  /**
   * Find or create a user node via Google OAuth
   */
  async findOrCreateGoogleUser({ email, name, avatar, googleId, selectedProduct = 'ananda' }) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.findByEmail(normalizedEmail);
    const now = new Date().toISOString();

    if (existing) {
      // User already exists, ensure id follows format if missing and update Google details
      let userId = existing.id;
      if (!userId || !userId.startsWith('user_uandwelabs_user')) {
        userId = await this.getNextUserId();
      }

      const cypher = `
        MATCH (u:User { email: $email })
        SET
          u.id = coalesce(u.id, $userId),
          u.name = coalesce(u.name, $name),
          u.avatar = coalesce(u.avatar, $avatar),
          u.googleId = coalesce($googleId, u.googleId),
          u.selectedProduct = coalesce($selectedProduct, u.selectedProduct),
          u.updatedAt = $now
        RETURN u {
          .id,
          .email,
          .name,
          .avatar,
          .role,
          .provider,
          .selectedProduct,
          .createdAt,
          .updatedAt
        } AS user
      `;
      const records = await writeQuery(cypher, {
        userId,
        email: normalizedEmail,
        name: name || normalizedEmail.split('@')[0],
        avatar: avatar || null,
        googleId: googleId || null,
        selectedProduct,
        now,
      });
      return records[0].get('user');
    }

    // New user signup via Google OAuth
    const id = await this.getNextUserId();
    const cypher = `
      CREATE (u:User {
        id: $id,
        email: $email,
        name: $name,
        avatar: $avatar,
        googleId: $googleId,
        provider: 'google',
        role: 'member',
        selectedProduct: $selectedProduct,
        lastLoginProduct: $selectedProduct,
        lastLoginAt: $now,
        lastLoginMethod: 'google',
        totalLogins: 1,
        commercialLogins: CASE WHEN $selectedProduct = 'ananda' OR $selectedProduct = 'commercial' THEN 1 ELSE 0 END,
        residencyLogins: CASE WHEN $selectedProduct = 'ananda-residential' OR $selectedProduct = 'residential' THEN 1 ELSE 0 END,
        daraLogins: CASE WHEN $selectedProduct = 'dara' THEN 1 ELSE 0 END,
        auraLogins: CASE WHEN $selectedProduct = 'aura' THEN 1 ELSE 0 END,
        createdAt: $now,
        updatedAt: $now
      })
      MERGE (s:SystemAnalytics { id: 'workspace_login_stats' })
      ON CREATE SET
        s.totalLogins = 1,
        s.commercialLogins = CASE WHEN $selectedProduct = 'ananda' OR $selectedProduct = 'commercial' THEN 1 ELSE 0 END,
        s.residencyLogins = CASE WHEN $selectedProduct = 'ananda-residential' OR $selectedProduct = 'residential' THEN 1 ELSE 0 END,
        s.daraLogins = CASE WHEN $selectedProduct = 'dara' THEN 1 ELSE 0 END,
        s.auraLogins = CASE WHEN $selectedProduct = 'aura' THEN 1 ELSE 0 END,
        s.createdAt = $now,
        s.updatedAt = $now
      ON MATCH SET
        s.totalLogins = coalesce(s.totalLogins, 0) + 1,
        s.commercialLogins = coalesce(s.commercialLogins, 0) + (CASE WHEN $selectedProduct = 'ananda' OR $selectedProduct = 'commercial' THEN 1 ELSE 0 END),
        s.residencyLogins = coalesce(s.residencyLogins, 0) + (CASE WHEN $selectedProduct = 'ananda-residential' OR $selectedProduct = 'residential' THEN 1 ELSE 0 END),
        s.daraLogins = coalesce(s.daraLogins, 0) + (CASE WHEN $selectedProduct = 'dara' THEN 1 ELSE 0 END),
        s.auraLogins = coalesce(s.auraLogins, 0) + (CASE WHEN $selectedProduct = 'aura' THEN 1 ELSE 0 END),
        s.updatedAt = $now
      RETURN u {
        .id,
        .email,
        .name,
        .avatar,
        .role,
        .provider,
        .selectedProduct,
        .createdAt,
        .updatedAt
      } AS user
    `;

    const records = await writeQuery(cypher, {
      id,
      email: normalizedEmail,
      name: name || normalizedEmail.split('@')[0],
      avatar: avatar || null,
      googleId: googleId || null,
      selectedProduct,
      now,
    });

    return records[0].get('user');
  },
};

