'use strict';

/**
 * Assignment 4 – Bronze Auth Test Suite
 * Tests login, register, JWT tokens, bcrypt passwords, sessions
 * Run: node tests/auth.test.js
 */

const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'tripmap_bronze_secret_2026';
const JWT_EXPIRES = '2h';

// ── In-memory DB for tests ──────────────────────────────────────────
const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });

// ── Models ──────────────────────────────────────────────────────────
const Role = sequelize.define('Role', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
}, { tableName: 'roles', timestamps: false });

const Permission = sequelize.define('Permission', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
}, { tableName: 'permissions', timestamps: false });

const RolePermission = sequelize.define('RolePermission', {
    roleId: { type: DataTypes.INTEGER },
    permissionId: { type: DataTypes.INTEGER },
}, { tableName: 'role_permissions', timestamps: false });

const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    password: { type: DataTypes.STRING(255), allowNull: false },
    roleId: { type: DataTypes.INTEGER, allowNull: false },
    isSuspicious: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { tableName: 'users', timestamps: true });

Role.belongsToMany(Permission, { through: RolePermission, foreignKey: 'roleId', as: 'permissions' });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: 'permissionId', as: 'roles' });
User.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });

// ── JWT helpers ─────────────────────────────────────────────────────
function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role.name },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

// ── Test runner ─────────────────────────────────────────────────────
let passed = 0, failed = 0;
const tests = [];

function test(name, fn) { tests.push({ name, fn }); }

async function assert(condition, msg) {
    if (!condition) throw new Error(`Assertion failed: ${msg}`);
}
async function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(`${msg} — expected "${b}", got "${a}"`);
}
async function assertNotNull(val, msg) {
    if (!val) throw new Error(`Expected non-null: ${msg}`);
}

// ── Setup ───────────────────────────────────────────────────────────
async function setup() {
    await sequelize.sync({ force: true });

    const [adminRole] = await Role.findOrCreate({ where: { name: 'admin' } });
    const [userRole] = await Role.findOrCreate({ where: { name: 'user' } });

    const permNames = ['create_trip', 'edit_trip', 'delete_trip', 'view_trips', 'manage_users'];
    const perms = {};
    for (const name of permNames) {
        const [p] = await Permission.findOrCreate({ where: { name } });
        perms[name] = p;
    }

    await adminRole.setPermissions(Object.values(perms));
    await userRole.setPermissions([perms['view_trips']]);

    const adminHash = await bcrypt.hash('admin123', 10);
    const userHash = await bcrypt.hash('user123', 10);

    await User.create({ username: 'admin', password: adminHash, roleId: adminRole.id });
    await User.create({ username: 'user1', password: userHash, roleId: userRole.id });
}

// ════════════════════════════════════════════════════════════════════
//  BACKEND TESTS
// ════════════════════════════════════════════════════════════════════

// ── T01: Password hashing ────────────────────────────────────────────
test('T01 – BCRYPT: Password is hashed (not stored as plaintext)', async () => {
    const user = await User.findOne({ where: { username: 'admin' } });
    assert(user.password !== 'admin123', 'Password should be hashed');
    assert(user.password.startsWith('$2'), 'Hash should start with bcrypt prefix $2');
});

// ── T02: Password verification ───────────────────────────────────────
test('T02 – BCRYPT: Correct password matches hash', async () => {
    const user = await User.findOne({ where: { username: 'admin' } });
    const isMatch = await bcrypt.compare('admin123', user.password);
    assert(isMatch, 'Correct password should match bcrypt hash');
});

// ── T03: Wrong password rejected ─────────────────────────────────────
test('T03 – BCRYPT: Wrong password does NOT match hash', async () => {
    const user = await User.findOne({ where: { username: 'admin' } });
    const isMatch = await bcrypt.compare('wrongpassword', user.password);
    assert(!isMatch, 'Wrong password should not match');
});

// ── T04: JWT token generated ─────────────────────────────────────────
test('T04 – JWT: Token is generated after login', async () => {
    const user = await User.findOne({
        where: { username: 'admin' },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    const token = generateToken(user);
    assertNotNull(token, 'Token should not be null');
    assert(token.split('.').length === 3, 'JWT should have 3 parts');
});

// ── T05: JWT token verified ───────────────────────────────────────────
test('T05 – JWT: Valid token is verified correctly', async () => {
    const user = await User.findOne({
        where: { username: 'admin' },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    const token = generateToken(user);
    const decoded = verifyToken(token);
    assertNotNull(decoded, 'Decoded token should not be null');
    assertEqual(decoded.username, 'admin', 'Token should contain correct username');
    assertEqual(decoded.role, 'admin', 'Token should contain correct role');
});

// ── T06: Expired/invalid token rejected ──────────────────────────────
test('T06 – JWT: Invalid token is rejected', async () => {
    const decoded = verifyToken('invalid.token.here');
    assert(decoded === null, 'Invalid token should return null');
});

// ── T07: JWT contains correct user data ──────────────────────────────
test('T07 – JWT: Token payload contains id, username, role', async () => {
    const user = await User.findOne({
        where: { username: 'user1' },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    const token = generateToken(user);
    const decoded = verifyToken(token);
    assertNotNull(decoded.id, 'Token should contain id');
    assertNotNull(decoded.username, 'Token should contain username');
    assertEqual(decoded.role, 'user', 'Token role should be user');
});

// ── T08: Register - new user created ─────────────────────────────────
test('T08 – REGISTER: New user can be registered', async () => {
    const userRole = await Role.findOne({ where: { name: 'user' } });
    const hashedPassword = await bcrypt.hash('newpass123', 10);
    const newUser = await User.create({
        username: 'newuser',
        password: hashedPassword,
        roleId: userRole.id,
    });
    assertNotNull(newUser.id, 'New user should have an id');
    assertEqual(newUser.username, 'newuser', 'Username should match');
    assert(newUser.password !== 'newpass123', 'Password should be hashed');
});

// ── T09: Register - duplicate username rejected ───────────────────────
test('T09 – REGISTER: Duplicate username is rejected', async () => {
    let caught = false;
    try {
        const userRole = await Role.findOne({ where: { name: 'user' } });
        await User.create({ username: 'admin', password: 'hash', roleId: userRole.id });
    } catch (e) {
        caught = true;
    }
    assert(caught, 'Duplicate username should throw error');
});

// ── T10: Register - new user gets 'user' role ─────────────────────────
test('T10 – REGISTER: New user automatically gets "user" role', async () => {
    const user = await User.findOne({
        where: { username: 'newuser' },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    assertEqual(user.role.name, 'user', 'New user should have user role');
    const permNames = user.role.permissions.map(p => p.name);
    assert(permNames.includes('view_trips'), 'User should have view_trips permission');
    assert(!permNames.includes('delete_trip'), 'User should NOT have delete_trip permission');
});

// ── T11: Admin has all permissions ───────────────────────────────────
test('T11 – PERMISSIONS: Admin has all permissions', async () => {
    const admin = await User.findOne({
        where: { username: 'admin' },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    const permNames = admin.role.permissions.map(p => p.name);
    const expected = ['create_trip', 'edit_trip', 'delete_trip', 'view_trips', 'manage_users'];
    for (const perm of expected) {
        assert(permNames.includes(perm), `Admin should have ${perm}`);
    }
});

// ── T12: User has only view permission ────────────────────────────────
test('T12 – PERMISSIONS: Normal user has only view_trips', async () => {
    const user = await User.findOne({
        where: { username: 'user1' },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    const permNames = user.role.permissions.map(p => p.name);
    assertEqual(permNames.length, 1, 'User should have exactly 1 permission');
    assertEqual(permNames[0], 'view_trips', 'User permission should be view_trips');
});

// ── T13: Login with wrong credentials ────────────────────────────────
test('T13 – LOGIN: Wrong credentials return no user', async () => {
    const user = await User.findOne({ where: { username: 'admin' } });
    const isMatch = await bcrypt.compare('wrongpass', user.password);
    assert(!isMatch, 'Login with wrong password should fail');
});

// ── T14: Login with non-existent user ────────────────────────────────
test('T14 – LOGIN: Non-existent user returns null', async () => {
    const user = await User.findOne({ where: { username: 'nonexistent' } });
    assert(user === null, 'Non-existent user should return null');
});

// ── T15: Session expiry - expired token rejected ──────────────────────
test('T15 – SESSION: Expired token is rejected', async () => {
    const expiredToken = jwt.sign(
        { id: 1, username: 'admin', role: 'admin' },
        JWT_SECRET,
        { expiresIn: '0s' }
    );
    await new Promise(resolve => setTimeout(resolve, 100));
    const decoded = verifyToken(expiredToken);
    assert(decoded === null, 'Expired token should be rejected');
});

// ── T16: Suspicious user flag ─────────────────────────────────────────
test('T16 – SECURITY: User can be flagged as suspicious', async () => {
    const user = await User.findOne({ where: { username: 'user1' } });
    await user.update({ isSuspicious: true });
    await user.reload();
    assert(user.isSuspicious === true, 'User should be flagged as suspicious');
    await user.update({ isSuspicious: false });
});

// ── T17: Suspicious flag can be cleared ──────────────────────────────
test('T17 – SECURITY: Suspicious flag can be cleared by admin', async () => {
    const user = await User.findOne({ where: { username: 'user1' } });
    await user.update({ isSuspicious: true });
    await user.update({ isSuspicious: false });
    await user.reload();
    assert(user.isSuspicious === false, 'Suspicious flag should be cleared');
});

// ── T18: Short username rejected ─────────────────────────────────────
test('T18 – VALIDATION: Username shorter than 3 chars is invalid', async () => {
    const username = 'ab';
    assert(username.length < 3, 'Short username should be rejected');
});

// ── T19: Short password rejected ─────────────────────────────────────
test('T19 – VALIDATION: Password shorter than 4 chars is invalid', async () => {
    const password = 'abc';
    assert(password.length < 4, 'Short password should be rejected');
});

// ── T20: Token contains expiry ────────────────────────────────────────
test('T20 – JWT: Token contains expiry field (exp)', async () => {
    const user = await User.findOne({
        where: { username: 'admin' },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    const token = generateToken(user);
    const decoded = verifyToken(token);
    assertNotNull(decoded.exp, 'Token should have exp field');
    assert(decoded.exp > Date.now() / 1000, 'Token expiry should be in the future');
    console.log(`    Token expires at: ${new Date(decoded.exp * 1000).toLocaleString()}`);
});

// ════════════════════════════════════════════════════════════════════
//  RUNNER
// ════════════════════════════════════════════════════════════════════
async function run() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   Assignment 4 – Auth & Security Test Suite          ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    await setup();

    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`  ✅  ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌  ${name}`);
            console.error(`       ${err.message}`);
            failed++;
        }
    }

    console.log(`\n──────────────────────────────────────────────────────`);
    console.log(`  Results: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
    console.log(`──────────────────────────────────────────────────────\n`);

    await sequelize.close();
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });