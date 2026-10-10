<?php
declare(strict_types=1);
$config = require __DIR__ . '/config.example.php';
$configError = false;
if (is_file(__DIR__ . '/config.local.php')) {
    try {
        $localConfig = require __DIR__ . '/config.local.php';
        if (!is_array($localConfig) || array_diff_key($localConfig, $config)) throw new RuntimeException('Invalid configuration keys');
        $config = array_replace($config, $localConfig);
        foreach ($config as $key => $value) {
            if ($key === 'db_port') {
                if (!is_int($value) || $value < 1 || $value > 65535) throw new RuntimeException('Invalid database port');
            } elseif ($key === 'cookie_secure') {
                if (!is_bool($value)) throw new RuntimeException('Invalid cookie setting');
            } elseif (!is_string($value)) throw new RuntimeException('Invalid configuration value type');
        }
        $config['google_client_id'] = trim($config['google_client_id']);
        $config['google_client_secret'] = trim($config['google_client_secret']);
        $app = parse_url($config['app_url']);
        if (!$app || !in_array($app['scheme'] ?? '', ['http', 'https'], true) || empty($app['host']) || isset($app['user']) || isset($app['pass']) || isset($app['query']) || isset($app['fragment']) || !in_array($app['path'] ?? '', ['', '/'], true)) throw new RuntimeException('Invalid app URL');
        $config['app_url'] = rtrim($config['app_url'], '/');
    } catch (Throwable $e) {
        // Never log configuration contents or a parse error that could contain a secret.
        error_log('Joblink: config.local.php is invalid. Check syntax, keys, and value types.');
        $configError = true;
        $config = require __DIR__ . '/config.example.php';
    }
}
function googleConfigError(): ?string {
    global $config;
    if ($config['google_client_id'] === '' || $config['google_client_secret'] === '') return 'google_not_configured';
    if (!preg_match('/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/', $config['google_client_id']) || strlen($config['google_client_secret']) < 16 || preg_match('/\s/', $config['google_client_secret']) || $config['google_redirect_uri'] !== $config['app_url'] . '/api/auth/google/callback') return 'google_invalid_config';
    return null;
}
function db(bool $withDatabase = true): PDO {
    global $config;
    $dsn = 'mysql:host=' . $config['db_host'] . ';port=' . $config['db_port'] . ';charset=utf8mb4';
    if ($withDatabase) $dsn .= ';dbname=' . $config['db_name'];
    return new PDO($dsn, $config['db_user'], $config['db_password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
}
function respond(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES); exit;
}
function publicUser(array $row): array {
    return ['id' => (int)$row['id'], 'name' => $row['name'], 'email' => $row['email'], 'provider' => $row['google_sub'] ? 'google' : 'email', 'emailVerified' => (bool)$row['email_verified'], 'avatarUrl' => $row['google_sub'] ? googleAvatarUrl($row['avatar_url'] ?? null) : null];
}
function googleAvatarUrl(mixed $value): ?string {
    if (!is_string($value) || strlen($value) > 2048) return null;
    $url = parse_url($value);
    $host = strtolower($url['host'] ?? '');
    return $url && ($url['scheme'] ?? '') === 'https' && !isset($url['user']) && !isset($url['pass']) && !isset($url['port']) && ($host === 'googleusercontent.com' || str_ends_with($host, '.googleusercontent.com')) ? $value : null;
}
function currentUser(PDO $pdo): ?array {
    if (empty($_SESSION['user_id'])) return null;
    if (time() - ($_SESSION['last_active'] ?? 0) > 7200) {
        session_regenerate_id(true);
        $_SESSION = ['csrf' => bin2hex(random_bytes(32))];
        return null;
    }
    $_SESSION['last_active'] = time();
    $query = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $query->execute([$_SESSION['user_id']]);
    $row = $query->fetch();
    return $row ? publicUser($row) : null;
}
function signIn(array $row): void {
    session_regenerate_id(true);
    $_SESSION = ['user_id' => (int)$row['id'], 'last_active' => time(), 'csrf' => bin2hex(random_bytes(32))];
}
function throttle(PDO $pdo, string $kind): void {
    $key = hash('sha256', $kind . ':' . ($_SERVER['REMOTE_ADDR'] ?? 'local'));
    $window = intdiv(time(), 900);
    $query = $pdo->prepare('INSERT INTO auth_attempts (attempt_key, window_id, attempts) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE attempts = attempts + 1');
    $query->execute([$key, $window]);
    $query = $pdo->prepare('SELECT attempts FROM auth_attempts WHERE attempt_key = ? AND window_id = ?');
    $query->execute([$key, $window]);
    if ((int)$query->fetchColumn() > 20) { header('Retry-After: 900'); respond(['error' => 'Too many attempts. Please try again in 15 minutes.'], 429); }
    $pdo->prepare('DELETE FROM auth_attempts WHERE window_id < ?')->execute([$window - 1]);
}
