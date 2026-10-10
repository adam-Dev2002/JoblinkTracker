<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/bootstrap.php';
if ($configError) throw new RuntimeException('Fix auth/config.local.php before initializing the database');
if (!preg_match('/^[a-zA-Z0-9_]+$/', $config['db_name'])) throw new RuntimeException('Invalid database name');
db(false)->exec('CREATE DATABASE IF NOT EXISTS `' . $config['db_name'] . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
$pdo = db();
$pdo->exec('CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    google_sub VARCHAR(255) NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB');
$pdo->exec('CREATE TABLE IF NOT EXISTS auth_attempts (
    attempt_key CHAR(64) NOT NULL,
    window_id BIGINT NOT NULL,
    attempts INT NOT NULL,
    PRIMARY KEY (attempt_key, window_id)
) ENGINE=InnoDB');
echo "JobScanner database ready.\n";
// Add profile photos to existing installations without replacing user records.
if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'avatar_url'")->fetch()) {
    $pdo->exec('ALTER TABLE users ADD COLUMN avatar_url VARCHAR(2048) NULL');
}
echo "Joblink profile photo storage ready.\n";
$pdo->exec('CREATE TABLE IF NOT EXISTS workspace_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    kind VARCHAR(32) NOT NULL,
    payload JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX workspace_owner (user_id, kind),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB');
echo "Joblink workspace storage ready.\n";

$pdo->exec('CREATE TABLE IF NOT EXISTS workspace_attachments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,item_id BIGINT UNSIGNED NOT NULL,name VARCHAR(200) NOT NULL,stored_name CHAR(32) NOT NULL,mime VARCHAR(150) NOT NULL,size INT UNSIGNED NOT NULL,FOREIGN KEY (item_id) REFERENCES workspace_items(id) ON DELETE CASCADE,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,INDEX attachment_owner(user_id,item_id)) ENGINE=InnoDB');
