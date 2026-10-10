<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
ini_set('display_errors', '0');
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
$runtime = __DIR__ . '/runtime';
if (!is_dir($runtime)) mkdir($runtime, 0700, true);
session_save_path($runtime);
session_name('jobscanner_session');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $config['cookie_secure'], 'httponly' => true, 'samesite' => 'Lax']);
session_start();
$_SESSION['csrf'] ??= bin2hex(random_bytes(32));
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
function redirectTo(string $path): never {
    global $config;
    header('Location: ' . $config['app_url'] . $path, true, 303); exit;
}
function googleRequest(string $url, ?array $form = null, ?string $token = null): array {
    $curl = curl_init($url);
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 10]);
    if ($form !== null) curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($form)]);
    if ($token !== null) curl_setopt($curl, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $token]);
    $body = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $curlError = curl_errno($curl);
    curl_close($curl);
    if ($body === false) {
        error_log('Joblink Google transport: curl error ' . $curlError);
        throw new RuntimeException('google_network_error');
    }
    if ($status !== 200) {
        $error = json_decode($body, true)['error'] ?? '';
        $safeError = is_string($error) && in_array($error, ['invalid_client', 'invalid_grant', 'unauthorized_client', 'invalid_request'], true) ? $error : 'request_rejected';
        error_log('Joblink Google response: HTTP ' . $status . ', ' . $safeError);
        throw new RuntimeException($safeError === 'invalid_client' ? 'google_rejected_credentials' : 'google_failed');
    }
    return json_decode($body, true, 32, JSON_THROW_ON_ERROR);
}
try {
    if ($configError) respond(['error' => 'Account configuration is invalid. Check auth/config.local.php and save the file.'], 503);
    if (str_starts_with($path, '/api/assistant/')) { require __DIR__ . '/assistant.php'; assistantRequest($path, $method); }
    if (str_starts_with($path, '/api/jobs/')) {
        if ($method !== 'GET') respond(['error' => 'Method not allowed'], 405);
        if (($path !== '/api/jobs/search') || !in_array($_GET['source'] ?? 'remotive', ['jsearch','indeed','jobstreet','onlinejobs','linkedin'], true)) session_write_close();
        require __DIR__ . '/jobs.php'; jobsRequest($path);
    }
    if (str_starts_with($path, '/api/workspace/')) {
        require __DIR__ . '/workspace.php'; workspaceRequest(db(), $path, $method);
    }
    if ($path === '/api/auth/google' && $method === 'GET') {
        if ($error = googleConfigError()) redirectTo('/sign-in?auth_error=' . $error);
        $_SESSION['oauth'] = ['state' => bin2hex(random_bytes(32)), 'verifier' => bin2hex(random_bytes(32)), 'created' => time()];
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $_SESSION['oauth']['verifier'], true)), '+/', '-_'), '=');
        header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
            'client_id' => $config['google_client_id'], 'redirect_uri' => $config['google_redirect_uri'],
            'response_type' => 'code', 'scope' => 'openid email profile', 'state' => $_SESSION['oauth']['state'],
            'code_challenge' => $challenge, 'code_challenge_method' => 'S256', 'prompt' => 'select_account',
        ])); exit;
    }
    if ($path === '/api/auth/google/callback' && $method === 'GET') {
        if ($error = googleConfigError()) redirectTo('/sign-in?auth_error=' . $error);
        $oauth = $_SESSION['oauth'] ?? null; unset($_SESSION['oauth']);
        if (!$oauth || time() - $oauth['created'] > 600 || !is_string($_GET['state'] ?? null) || !hash_equals($oauth['state'], $_GET['state'])) redirectTo('/sign-in?auth_error=invalid_google_state');
        if (isset($_GET['error'])) redirectTo('/sign-in?auth_error=google_cancelled');
        if (!is_string($_GET['code'] ?? null)) redirectTo('/sign-in?auth_error=google_failed');
        $tokens = googleRequest('https://oauth2.googleapis.com/token', [
            'code' => $_GET['code'], 'client_id' => $config['google_client_id'], 'client_secret' => $config['google_client_secret'],
            'redirect_uri' => $config['google_redirect_uri'], 'grant_type' => 'authorization_code', 'code_verifier' => $oauth['verifier'],
        ]);
        // Obtain identity directly from Google's HTTPS UserInfo endpoint; never trust browser-supplied identity or an unverified JWT.
        $profile = googleRequest('https://openidconnect.googleapis.com/v1/userinfo', null, $tokens['access_token'] ?? '');
        if (empty($profile['sub']) || ($profile['email_verified'] ?? false) !== true || !filter_var($profile['email'] ?? '', FILTER_VALIDATE_EMAIL)) redirectTo('/sign-in?auth_error=google_failed');
        $pdo = db();
        $avatarUrl = googleAvatarUrl($profile['picture'] ?? null);
        $query = $pdo->prepare('SELECT * FROM users WHERE google_sub = ?'); $query->execute([$profile['sub']]); $user = $query->fetch();
        if (!$user) {
            // Never silently link an existing password account using an email match.
            $query = $pdo->prepare('SELECT id FROM users WHERE email = ?'); $query->execute([strtolower($profile['email'])]);
            if ($query->fetch()) redirectTo('/sign-in?auth_error=email_account_exists');
            $query = $pdo->prepare('INSERT INTO users (name, email, google_sub, email_verified, avatar_url) VALUES (?, ?, ?, 1, ?)');
            $query->execute([mb_substr($profile['name'] ?? 'Job seeker', 0, 100), strtolower($profile['email']), $profile['sub'], $avatarUrl]);
            $user = ['id' => $pdo->lastInsertId()];
        } else {
            $pdo->prepare('UPDATE users SET avatar_url = COALESCE(?, avatar_url) WHERE id = ?')->execute([$avatarUrl, $user['id']]);
        }
        signIn($user); redirectTo('/job-listing');
    }
    $pdo = db();
    if ($path === '/api/auth/session' && $method === 'GET') respond(['user' => currentUser($pdo), 'csrf' => $_SESSION['csrf'], 'googleEnabled' => googleConfigError() === null]);
    if (!in_array($path, ['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/profile', '/api/auth/password'], true)) respond(['error' => 'Not found'], 404);
    if ($method !== 'POST') { header('Allow: POST'); respond(['error' => 'Method not allowed'], 405); }
    if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $config['app_url']) respond(['error' => 'Invalid request origin'], 403);
    if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) respond(['error' => 'Your session expired. Refresh the page and try again.'], 403);
    if ($path === '/api/auth/logout') {
        $_SESSION = []; session_destroy();
        setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => '/', 'secure' => $config['cookie_secure'], 'httponly' => true, 'samesite' => 'Lax']);
        respond(['ok' => true]);
    }
    if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) respond(['error' => 'JSON required'], 415);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) respond(['error' => 'Request too large'], 413);
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) respond(['error' => 'Invalid request'], 400);
    throttle($pdo, $path);
    if (in_array($path, ['/api/auth/profile', '/api/auth/password'], true)) {
        $current = currentUser($pdo);
        if (!$current) respond(['error' => 'Please sign in to update your account.'], 401);
        if ($path === '/api/auth/profile') {
            $name = is_string($input['name'] ?? null) ? trim($input['name']) : '';
            if ($name === '' || mb_strlen($name) > 100) respond(['error' => 'Enter a name of up to 100 characters.'], 422);
            $pdo->prepare('UPDATE users SET name = ? WHERE id = ?')->execute([$name, $current['id']]);
            respond(['user' => currentUser($pdo)]);
        }
        $query = $pdo->prepare('SELECT * FROM users WHERE id = ?'); $query->execute([$current['id']]); $row = $query->fetch();
        if (!$row['password_hash']) respond(['error' => 'Your password is managed by Google.'], 422);
        $old = is_string($input['currentPassword'] ?? null) ? $input['currentPassword'] : '';
        $new = is_string($input['newPassword'] ?? null) ? $input['newPassword'] : '';
        if (strlen($old) > 72 || !password_verify($old, $row['password_hash'])) respond(['error' => 'Current password is incorrect.'], 401);
        if (strlen($new) < 12 || strlen($new) > 72) respond(['error' => 'Use a new password between 12 and 72 bytes.'], 422);
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $current['id']]);
        signIn($row);
        respond(['ok' => true, 'csrf' => $_SESSION['csrf']]);
    }
    $email = is_string($input['email'] ?? null) ? strtolower(trim($input['email'])) : '';
    $password = is_string($input['password'] ?? null) ? $input['password'] : '';
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) respond(['error' => 'Enter a valid email address.'], 422);
    if ($path === '/api/auth/register') {
        $name = is_string($input['name'] ?? null) ? trim($input['name']) : '';
        if ($name === '' || mb_strlen($name) > 100) respond(['error' => 'Enter a name of up to 100 characters.'], 422);
        if (strlen($password) < 12 || strlen($password) > 72) respond(['error' => 'Use a password between 12 and 72 bytes (usually characters).'], 422);
        $query = $pdo->prepare('SELECT id FROM users WHERE email = ?'); $query->execute([$email]);
        if ($query->fetch()) respond(['error' => 'Unable to create this account. Try signing in instead.'], 409);
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $query = $pdo->prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
        try { $query->execute([$name, $email, $hash]); } catch (PDOException $e) { if ($e->getCode() === '23000') respond(['error' => 'Unable to create this account. Try signing in instead.'], 409); throw $e; }
        $user = ['id' => $pdo->lastInsertId(), 'name' => $name, 'email' => $email, 'google_sub' => null, 'email_verified' => false];
        signIn($user); respond(['user' => publicUser($user)], 201);
    }
    $query = $pdo->prepare('SELECT * FROM users WHERE email = ?'); $query->execute([$email]); $user = $query->fetch();
    // Use a real dummy hash for missing accounts to reduce timing-based email discovery.
    $hash = $user['password_hash'] ?? '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
    $valid = strlen($password) <= 72 && password_verify($password, $hash);
    if (!$valid || !$user || !$user['password_hash']) respond(['error' => 'Email or password is incorrect.'], 401);
    if (password_needs_rehash($hash, PASSWORD_DEFAULT)) $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
    signIn($user); respond(['user' => publicUser($user)]);
} catch (Throwable $e) {
    error_log('Joblink auth: request failed (' . get_class($e) . ').');
    if ($path === '/api/auth/google/callback') {
        $code = in_array($e->getMessage(), ['google_network_error', 'google_rejected_credentials'], true) ? $e->getMessage() : 'google_failed';
        redirectTo('/sign-in?auth_error=' . $code);
    }
    respond(['error' => 'Account service is unavailable. Please try again later.'], 503);
}
