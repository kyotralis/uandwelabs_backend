import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { readQuery, writeQuery } from '../config/neo4j.js';

export const UserModel = {
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
  async create({ email, password, name, role = 'member' }) {
    const normalizedEmail = email.trim().toLowerCase();
    const id = crypto.randomUUID();
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
        createdAt: $now,
        updatedAt: $now
      })
      RETURN u {
        .id,
        .email,
        .name,
        .role,
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
      now,
    });

    return records[0].get('user');
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
  async findOrCreateGoogleUser({ email, name, avatar, googleId }) {
    const normalizedEmail = email.trim().toLowerCase();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const cypher = `
      MERGE (u:User { email: $email })
      ON CREATE SET
        u.id = $id,
        u.name = $name,
        u.avatar = $avatar,
        u.googleId = $googleId,
        u.provider = 'google',
        u.role = 'member',
        u.createdAt = $now,
        u.updatedAt = $now
      ON MATCH SET
        u.name = coalesce(u.name, $name),
        u.avatar = coalesce(u.avatar, $avatar),
        u.googleId = $googleId,
        u.updatedAt = $now
      RETURN u {
        .id,
        .email,
        .name,
        .avatar,
        .role,
        .provider,
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
      now,
    });

    return records[0].get('user');
  },
};

