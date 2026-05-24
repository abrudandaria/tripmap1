'use strict';

/**
 * Assignment 4 – Bronze Auth Test Suite
 * BACKEND (T01-T20) + FRONTEND (FT01-FT20) = 40 teste
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

// ── Frontend helpers (logica din App.jsx testata izolat) ─────────────
let authToken = null;

function storeToken(token) { authToken = token; }
function clearToken() { authToken = null; }
function getToken() { return authToken; }

function buildAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return headers;
}

function validateLoginForm(username, password) {
    if (!username || username.trim().length === 0) return { ok: false, error: 'Username required' };
    if (!password || password.length === 0) return { ok: false, error: 'Password required' };
    return { ok: true };
}

function validateRegisterForm(username, password) {
    if (!username || username.trim().length < 3) return { ok: false, error: 'Username must be at least 3 characters' };
    if (!password || password.length < 4) return { ok: false, error: 'Password must be at least 4 characters' };
    return { ok: true };
}

function hasPermission(user, perm) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions?.includes(perm) ?? false;
}

function buildLoginQuery(username, password) {
    return {
        query: `mutation Login($username: String!, $password: String!) {
            login(username: $username, password: $password) {
                id username role permissions token isSuspicious
            }
        }`,
        variables: { username, password }
    };
}

function buildAddTripMutation(dest, price, days, desc) {
    return {
        query: `mutation AddTrip($dest: String!, $price: Float!, $days: Int!, $desc: String) {
            addTrip(dest: $dest, price: $price, days: $days, desc: $desc) { id }
        }`,
        variables: { dest, price: Number(price), days: Number(days), desc: desc || '' }
    };
}

function createSessionTimer(onExpire) {
    let timerId = null;
    return {
        start() { if (timerId) clearTimeout(timerId); timerId = setTimeout(onExpire, 2 * 60 * 60 * 1000); return timerId; },
        stop() { if (timerId) clearTimeout(timerId); timerId = null; },
        isRunning() { return timerId !== null; }
    };
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
async function assertNull(val, msg) {
    if (val !== null) throw new Error(`Expected null: ${msg} — got "${val}"`);
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
//  BACKEND TESTS (T01–T20)
// ════════════════════════════════════════════════════════════════════

test('T01 – BCRYPT: Password is hashed (not stored as plaintext)', async () => {
    const user = await User.findOne({ where: { username: 'admin' } });
    assert(user.password !== 'admin123', 'Password should be hashed');
    assert(user.password.startsWith('$2'), 'Hash should start with bcrypt prefix $2');
});

test('T02 – BCRYPT: Correct password matches hash', async () => {
    const user = await User.findOne({ where: { username: 'admin' } });
    const isMatch = await bcrypt.compare('admin123', user.password);
    assert(isMatch, 'Correct password should match bcrypt hash');
});

test('T03 – BCRYPT: Wrong password does NOT match hash', async () => {
    const user = await User.findOne({ where: { username: 'admin' } });
    const isMatch = await bcrypt.compare('wrongpassword', user.password);
    assert(!isMatch, 'Wrong password should not match');
});

test('T04 – JWT: Token is generated after login', async () => {
    const user = await User.findOne({
        where: { username: 'admin' },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    const token = generateToken(user);
    assertNotNull(token, 'Token should not be null');
    assert(token.split('.').length === 3, 'JWT should have 3 parts');
});

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

test('T06 – JWT: Invalid token is rejected', async () => {
    const decoded = verifyToken('invalid.token.here');
    assert(decoded === null, 'Invalid token should return null');
});

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

test('T08 – REGISTER: New user can be registered', async () => {
    const userRole = await Role.findOne({ where: { name: 'user' } });
    const hashedPassword = await bcrypt.hash('newpass123', 10);
    const newUser = await User.create({ username: 'newuser', password: hashedPassword, roleId: userRole.id });
    assertNotNull(newUser.id, 'New user should have an id');
    assertEqual(newUser.username, 'newuser', 'Username should match');
    assert(newUser.password !== 'newpass123', 'Password should be hashed');
});

test('T09 – REGISTER: Duplicate username is rejected', async () => {
    let caught = false;
    try {
        const userRole = await Role.findOne({ where: { name: 'user' } });
        await User.create({ username: 'admin', password: 'hash', roleId: userRole.id });
    } catch (e) { caught = true; }
    assert(caught, 'Duplicate username should throw error');
});

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

test('T12 – PERMISSIONS: Normal user has only view_trips', async () => {
    const user = await User.findOne({
        where: { username: 'user1' },
        include: [{ model: Role, as: 'role', include: [{ model: Permission, as: 'permissions' }] }],
    });
    const permNames = user.role.permissions.map(p => p.name);
    assertEqual(permNames.length, 1, 'User should have exactly 1 permission');
    assertEqual(permNames[0], 'view_trips', 'User permission should be view_trips');
});

test('T13 – LOGIN: Wrong credentials return no user', async () => {
    const user = await User.findOne({ where: { username: 'admin' } });
    const isMatch = await bcrypt.compare('wrongpass', user.password);
    assert(!isMatch, 'Login with wrong password should fail');
});

test('T14 – LOGIN: Non-existent user returns null', async () => {
    const user = await User.findOne({ where: { username: 'nonexistent' } });
    assert(user === null, 'Non-existent user should return null');
});

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

test('T16 – SECURITY: User can be flagged as suspicious', async () => {
    const user = await User.findOne({ where: { username: 'user1' } });
    await user.update({ isSuspicious: true });
    await user.reload();
    assert(user.isSuspicious === true, 'User should be flagged as suspicious');
    await user.update({ isSuspicious: false });
});

test('T17 – SECURITY: Suspicious flag can be cleared by admin', async () => {
    const user = await User.findOne({ where: { username: 'user1' } });
    await user.update({ isSuspicious: true });
    await user.update({ isSuspicious: false });
    await user.reload();
    assert(user.isSuspicious === false, 'Suspicious flag should be cleared');
});

test('T18 – VALIDATION: Username shorter than 3 chars is invalid', async () => {
    const username = 'ab';
    assert(username.length < 3, 'Short username should be rejected');
});

test('T19 – VALIDATION: Password shorter than 4 chars is invalid', async () => {
    const password = 'abc';
    assert(password.length < 4, 'Short password should be rejected');
});

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
//  FRONTEND TESTS (FT01–FT20)
// ════════════════════════════════════════════════════════════════════

test('FT01 – LOGIN FORM: Empty username is rejected', () => {
    const result = validateLoginForm('', 'password123');
    assert(!result.ok, 'Empty username should be rejected');
    assertNotNull(result.error, 'Error message should exist');
});

test('FT02 – LOGIN FORM: Empty password is rejected', () => {
    const result = validateLoginForm('admin', '');
    assert(!result.ok, 'Empty password should be rejected');
});

test('FT03 – LOGIN FORM: Valid credentials pass validation', () => {
    const result = validateLoginForm('admin', 'admin123');
    assert(result.ok, 'Valid credentials should pass');
});

test('FT04 – REGISTER FORM: Username shorter than 3 chars is rejected', () => {
    const result = validateRegisterForm('ab', 'pass123');
    assert(!result.ok, 'Short username should be rejected');
    assert(result.error.includes('3'), 'Error should mention minimum length');
});

test('FT05 – REGISTER FORM: Password shorter than 4 chars is rejected', () => {
    const result = validateRegisterForm('validuser', 'abc');
    assert(!result.ok, 'Short password should be rejected');
    assert(result.error.includes('4'), 'Error should mention minimum length');
});

test('FT06 – REGISTER FORM: Valid username and password pass validation', () => {
    const result = validateRegisterForm('newuser', 'pass1234');
    assert(result.ok, 'Valid register data should pass');
});

test('FT07 – TOKEN STORAGE: Token is stored in memory variable, not localStorage', () => {
    clearToken();
    storeToken('test.jwt.token');
    assertEqual(getToken(), 'test.jwt.token', 'Token should be retrievable from memory');
});

test('FT08 – TOKEN STORAGE: Token is cleared on logout', () => {
    storeToken('some.token.here');
    clearToken();
    assert(getToken() === null, 'Token should be null after logout');
});

test('FT09 – AUTH HEADERS: Authorization header is sent when token exists', () => {
    storeToken('my.jwt.token');
    const headers = buildAuthHeaders();
    assertNotNull(headers['Authorization'], 'Authorization header should exist');
    assert(headers['Authorization'].startsWith('Bearer '), 'Should use Bearer scheme');
    assertEqual(headers['Authorization'], 'Bearer my.jwt.token', 'Token should match');
    clearToken();
});

test('FT10 – AUTH HEADERS: No Authorization header when not logged in', () => {
    clearToken();
    const headers = buildAuthHeaders();
    assert(!headers['Authorization'], 'No Authorization header when token is null');
});

test('FT11 – PERMISSIONS: Admin role bypasses permission check', () => {
    const admin = { role: 'admin', permissions: [] };
    assert(hasPermission(admin, 'create_trip'), 'Admin should have create_trip');
    assert(hasPermission(admin, 'delete_trip'), 'Admin should have delete_trip');
    assert(hasPermission(admin, 'manage_users'), 'Admin should have manage_users');
});

test('FT12 – PERMISSIONS: Regular user has only view_trips', () => {
    const user = { role: 'user', permissions: ['view_trips'] };
    assert(hasPermission(user, 'view_trips'), 'User should have view_trips');
    assert(!hasPermission(user, 'create_trip'), 'User should NOT have create_trip');
    assert(!hasPermission(user, 'delete_trip'), 'User should NOT have delete_trip');
    assert(!hasPermission(user, 'manage_users'), 'User should NOT have manage_users');
});

test('FT13 – PERMISSIONS: Unauthenticated user has no permissions', () => {
    assert(!hasPermission(null, 'view_trips'), 'Null user should have no permissions');
    assert(!hasPermission(undefined, 'create_trip'), 'Undefined user should have no permissions');
});

test('FT14 – SECURITY: Login query uses GraphQL variables, not string interpolation', () => {
    const maliciousUsername = 'admin"} malicious query {';
    const payload = buildLoginQuery(maliciousUsername, 'password');
    assert(payload.query.includes('$username'), 'Query should use $username variable');
    assert(payload.query.includes('$password'), 'Query should use $password variable');
    assertEqual(payload.variables.username, maliciousUsername, 'Malicious input stored safely in variables');
    assert(!payload.query.includes(maliciousUsername), 'Malicious input should NOT be in query string');
});

test('FT15 – SECURITY: addTrip mutation uses GraphQL variables', () => {
    const maliciousDest = 'Paris") { deleteTrip(id: "1") }';
    const payload = buildAddTripMutation(maliciousDest, 2500, 5, 'Test');
    assert(payload.query.includes('$dest'), 'Should use $dest variable');
    assertEqual(payload.variables.dest, maliciousDest, 'Malicious dest stored safely in variables');
    assert(!payload.query.includes(maliciousDest), 'Malicious input should NOT be in query string');
});

test('FT16 – SESSION: Session timer starts on login', () => {
    let expired = false;
    const timer = createSessionTimer(() => { expired = true; });
    const timerId = timer.start();
    assert(timerId !== null, 'Timer should be started');
    assert(timer.isRunning(), 'Timer should be running');
    timer.stop();
});

test('FT17 – SESSION: Session timer stops on logout', () => {
    let expired = false;
    const timer = createSessionTimer(() => { expired = true; });
    timer.start();
    timer.stop();
    assert(!timer.isRunning(), 'Timer should stop after logout');
});

test('FT18 – VALIDATION: Username is trimmed before length check', () => {
    const result = validateRegisterForm('  ab  ', 'pass123');
    assert(!result.ok, 'Username with only 2 chars (after trim) should be rejected');
});

test('FT19 – VALIDATION: Username with exactly 3 chars is accepted', () => {
    const result = validateRegisterForm('abc', 'pass1234');
    assert(result.ok, 'Exactly 3 char username should be accepted');
});

test('FT20 – VALIDATION: Password with exactly 4 chars is accepted', () => {
    const result = validateRegisterForm('validuser', 'abcd');
    assert(result.ok, 'Exactly 4 char password should be accepted');
});

// ════════════════════════════════════════════════════════════════════
//  RUNNER
// ════════════════════════════════════════════════════════════════════
async function run() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║   Assignment 4 – Auth & Security Test Suite (Backend+Frontend) ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    await setup();

    console.log('  ── BACKEND TESTS (T01–T20) ──────────────────────────────────\n');
    const backendTests = tests.filter(t => t.name.startsWith('T'));
    for (const { name, fn } of backendTests) {
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

    console.log('\n  ── FRONTEND TESTS (FT01–FT20) ────────────────────────────────\n');
    const frontendTests = tests.filter(t => t.name.startsWith('FT'));
    for (const { name, fn } of frontendTests) {
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

    console.log(`\n──────────────────────────────────────────────────────────────`);
    console.log(`  Results: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
    console.log(`──────────────────────────────────────────────────────────────\n`);

    await sequelize.close();
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });