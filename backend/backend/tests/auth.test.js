'use strict';

/**
 * Assignment 4 – Bronze Auth Test Suite — FRONTEND
 * Testeaza logica de validare din frontend (username/password rules,
 * token storage in memory, session timer, permission checks)
 *
 * Nu necesita browser real — ruleaza cu Node.js pur.
 * Run: node tests/frontend.auth.test.js
 */

// ── In-memory mock pentru authToken (simulam modulul App.jsx) ────────
let authToken = null; // BRONZE A4: stocat in memorie, nu localStorage

// ── Simulam logica de validare din handleLogin / handleRegister ───────
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

// ── Simulam stocarea tokenului in memorie ─────────────────────────────
function storeToken(token) {
    authToken = token; // in memorie — nu localStorage
}

function clearToken() {
    authToken = null;
}

function getToken() {
    return authToken;
}

// ── Simulam verificarea permisiunilor din hasPermission ───────────────
function hasPermission(user, perm) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions?.includes(perm) ?? false;
}

// ── Simulam construirea headerelor de autentificare ───────────────────
function buildAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return headers;
}

// ── Simulam session timer (fara setTimeout real) ──────────────────────
function createSessionTimer(onExpire) {
    let timerId = null;
    return {
        start() {
            if (timerId) clearTimeout(timerId);
            timerId = setTimeout(onExpire, 2 * 60 * 60 * 1000);
            return timerId;
        },
        stop() {
            if (timerId) clearTimeout(timerId);
            timerId = null;
        },
        isRunning() {
            return timerId !== null;
        }
    };
}

// ── Simulam construirea GraphQL query cu variabile ────────────────────
function buildLoginQuery(username, password) {
    return {
        query: `
            mutation Login($username: String!, $password: String!) {
                login(username: $username, password: $password) {
                    id username role permissions token isSuspicious
                }
            }
        `,
        variables: { username, password }
    };
}

function buildAddTripMutation(dest, price, days, desc) {
    return {
        query: `
            mutation AddTrip($dest: String!, $price: Float!, $days: Int!, $desc: String) {
                addTrip(dest: $dest, price: $price, days: $days, desc: $desc) { id }
            }
        `,
        variables: { dest, price: Number(price), days: Number(days), desc: desc || '' }
    };
}

// ════════════════════════════════════════════════════════════════════
//  TEST RUNNER
// ════════════════════════════════════════════════════════════════════
let passed = 0, failed = 0;
const tests = [];

function test(name, fn) { tests.push({ name, fn }); }

function assert(condition, msg) {
    if (!condition) throw new Error(`Assertion failed: ${msg}`);
}
function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(`${msg} — expected "${b}", got "${a}"`);
}
function assertNotNull(val, msg) {
    if (val === null || val === undefined) throw new Error(`Expected non-null: ${msg}`);
}
function assertNull(val, msg) {
    if (val !== null) throw new Error(`Expected null: ${msg} — got "${val}"`);
}

// ════════════════════════════════════════════════════════════════════
//  FRONTEND TESTS
// ════════════════════════════════════════════════════════════════════

// ── FT01: Login form — campuri goale respinse ─────────────────────────
test('FT01 – LOGIN FORM: Empty username is rejected', () => {
    const result = validateLoginForm('', 'password123');
    assert(!result.ok, 'Empty username should be rejected');
    assertNotNull(result.error, 'Error message should exist');
});

// ── FT02: Login form — parola goala respinsa ──────────────────────────
test('FT02 – LOGIN FORM: Empty password is rejected', () => {
    const result = validateLoginForm('admin', '');
    assert(!result.ok, 'Empty password should be rejected');
});

// ── FT03: Login form — date valide acceptate ──────────────────────────
test('FT03 – LOGIN FORM: Valid credentials pass validation', () => {
    const result = validateLoginForm('admin', 'admin123');
    assert(result.ok, 'Valid credentials should pass');
});

// ── FT04: Register — username prea scurt respins ──────────────────────
test('FT04 – REGISTER FORM: Username shorter than 3 chars is rejected', () => {
    const result = validateRegisterForm('ab', 'pass123');
    assert(!result.ok, 'Short username should be rejected');
    assert(result.error.includes('3'), 'Error should mention minimum length');
});

// ── FT05: Register — parola prea scurta respinsa ──────────────────────
test('FT05 – REGISTER FORM: Password shorter than 4 chars is rejected', () => {
    const result = validateRegisterForm('validuser', 'abc');
    assert(!result.ok, 'Short password should be rejected');
    assert(result.error.includes('4'), 'Error should mention minimum length');
});

// ── FT06: Register — date valide acceptate ────────────────────────────
test('FT06 – REGISTER FORM: Valid username and password pass validation', () => {
    const result = validateRegisterForm('newuser', 'pass1234');
    assert(result.ok, 'Valid register data should pass');
});

// ── FT07: Token stocat in memorie, nu localStorage ────────────────────
test('FT07 – TOKEN STORAGE: Token is stored in memory variable, not localStorage', () => {
    clearToken();
    storeToken('test.jwt.token');
    assertEqual(getToken(), 'test.jwt.token', 'Token should be retrievable from memory');
    // Verificam ca NU e in localStorage (simulat — in browser ar fi window.localStorage)
    assert(typeof localStorage === 'undefined' || localStorage.getItem('authToken') === null,
        'Token should NOT be in localStorage');
});

// ── FT08: Token sters la logout ───────────────────────────────────────
test('FT08 – TOKEN STORAGE: Token is cleared on logout', () => {
    storeToken('some.token.here');
    clearToken();
    assertNull(getToken(), 'Token should be null after logout');
});

// ── FT09: Header Authorization trimis cand token exista ───────────────
test('FT09 – AUTH HEADERS: Authorization header is sent when token exists', () => {
    storeToken('my.jwt.token');
    const headers = buildAuthHeaders();
    assertNotNull(headers['Authorization'], 'Authorization header should exist');
    assert(headers['Authorization'].startsWith('Bearer '), 'Should use Bearer scheme');
    assertEqual(headers['Authorization'], 'Bearer my.jwt.token', 'Token should match');
    clearToken();
});

// ── FT10: Header Authorization absent cand nu e token ─────────────────
test('FT10 – AUTH HEADERS: No Authorization header when not logged in', () => {
    clearToken();
    const headers = buildAuthHeaders();
    assert(!headers['Authorization'], 'No Authorization header when token is null');
});

// ── FT11: Admin are toate permisiunile ────────────────────────────────
test('FT11 – PERMISSIONS: Admin role bypasses permission check', () => {
    const admin = { role: 'admin', permissions: [] };
    assert(hasPermission(admin, 'create_trip'), 'Admin should have create_trip');
    assert(hasPermission(admin, 'delete_trip'), 'Admin should have delete_trip');
    assert(hasPermission(admin, 'manage_users'), 'Admin should have manage_users');
});

// ── FT12: User are doar view_trips ────────────────────────────────────
test('FT12 – PERMISSIONS: Regular user has only view_trips', () => {
    const user = { role: 'user', permissions: ['view_trips'] };
    assert(hasPermission(user, 'view_trips'), 'User should have view_trips');
    assert(!hasPermission(user, 'create_trip'), 'User should NOT have create_trip');
    assert(!hasPermission(user, 'delete_trip'), 'User should NOT have delete_trip');
    assert(!hasPermission(user, 'manage_users'), 'User should NOT have manage_users');
});

// ── FT13: Utilizator nelogat nu are permisiuni ────────────────────────
test('FT13 – PERMISSIONS: Unauthenticated user has no permissions', () => {
    assert(!hasPermission(null, 'view_trips'), 'Null user should have no permissions');
    assert(!hasPermission(undefined, 'create_trip'), 'Undefined user should have no permissions');
});

// ── FT14: GraphQL query foloseste variabile (nu string interpolation) ──
test('FT14 – SECURITY: Login query uses GraphQL variables, not string interpolation', () => {
    const maliciousUsername = 'admin"} malicious query {';
    const payload = buildLoginQuery(maliciousUsername, 'password');
    // Variabilele sunt separate de query — nu pot corupe sintaxa GraphQL
    assert(payload.query.includes('$username'), 'Query should use $username variable');
    assert(payload.query.includes('$password'), 'Query should use $password variable');
    assertEqual(payload.variables.username, maliciousUsername, 'Malicious input stored safely in variables');
    assert(!payload.query.includes(maliciousUsername), 'Malicious input should NOT be in query string');
});

// ── FT15: GraphQL addTrip foloseste variabile ─────────────────────────
test('FT15 – SECURITY: addTrip mutation uses GraphQL variables', () => {
    const maliciousDest = 'Paris") { deleteTrip(id: "1') }';
const payload = buildAddTripMutation(maliciousDest, 2500, 5, 'Test');
assert(payload.query.includes('$dest'), 'Should use $dest variable');
assertEqual(payload.variables.dest, maliciousDest, 'Malicious dest stored safely in variables');
assert(!payload.query.includes(maliciousDest), 'Malicious input should NOT be in query string');
});

// ── FT16: Session timer porneste la login ─────────────────────────────
test('FT16 – SESSION: Session timer starts on login', () => {
    let expired = false;
    const timer = createSessionTimer(() => { expired = true; });
    const timerId = timer.start();
    assert(timerId !== null, 'Timer should be started');
    assert(timer.isRunning(), 'Timer should be running');
    timer.stop();
});

// ── FT17: Session timer se opreste la logout ──────────────────────────
test('FT17 – SESSION: Session timer stops on logout', () => {
    let expired = false;
    const timer = createSessionTimer(() => { expired = true; });
    timer.start();
    timer.stop();
    assert(!timer.isRunning(), 'Timer should stop after logout');
});

// ── FT18: Username cu spatii trimmed inainte de validare ──────────────
test('FT18 – VALIDATION: Username is trimmed before length check', () => {
    // "  ab  " are 2 chars dupa trim — trebuie respins
    const result = validateRegisterForm('  ab  ', 'pass123');
    assert(!result.ok, 'Username with only 2 chars (after trim) should be rejected');
});

// ── FT19: Username exact 3 caractere acceptat ─────────────────────────
test('FT19 – VALIDATION: Username with exactly 3 chars is accepted', () => {
    const result = validateRegisterForm('abc', 'pass1234');
    assert(result.ok, 'Exactly 3 char username should be accepted');
});

// ── FT20: Parola exact 4 caractere acceptata ──────────────────────────
test('FT20 – VALIDATION: Password with exactly 4 chars is accepted', () => {
    const result = validateRegisterForm('validuser', 'abcd');
    assert(result.ok, 'Exactly 4 char password should be accepted');
});

// ════════════════════════════════════════════════════════════════════
//  RUNNER
// ════════════════════════════════════════════════════════════════════
async function run() {
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║   Assignment 4 – Frontend Auth Test Suite            ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

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

    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });