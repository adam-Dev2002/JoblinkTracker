<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/bootstrap.php';
$email = $argv[1] ?? '';
if (!preg_match('/^auth-test-[0-9]+@example\.invalid$/', $email)) throw new RuntimeException('Only generated test accounts may be inspected or deleted');
$pdo = db();
if (($argv[2] ?? '') === 'cleanup') {
    $pdo->prepare('DELETE FROM users WHERE email = ?')->execute([$email]);
    echo "Test account removed.\n"; exit;
}
$query = $pdo->prepare('SELECT * FROM users WHERE email = ?'); $query->execute([$email]); $user = $query->fetch();
if (!$user || !password_verify('Test-only-password-2026', $user['password_hash']) || $user['password_hash'] === 'Test-only-password-2026' || $user['email_verified']) throw new RuntimeException('Password storage or verification flag assertion failed');
echo "Database stores a verified password hash and an unverified email flag.\n";
