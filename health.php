<?php
// Minimal health for this folder only (safe to leave on)
declare(strict_types=1);
header('Content-Type: application/json');

// Minimal .env reader for this probe
$envFile = __DIR__.'/.env';
if (is_readable($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
    if ($line[0] === '#' || strpos($line, '=') === false) continue;
    [$k,$v] = explode('=', $line, 2);
    $k = trim($k); $v = trim($v, " \t\n\r\0\x0B\"'");
    putenv("$k=$v"); $_ENV[$k] = $v;
  }
}

http_response_code(200);

// Show basic module/file presence without touching PHPMailer/Composer
$base = __DIR__;
echo json_encode([
  'ok' => true,
  'time' => date('c'),
  'php' => PHP_VERSION,
  'cwd' => $base,
  'vendor_autoload_exists' => is_readable($base.'/vendor/autoload.php'),
  'phpmailer_dir_exists'   => is_dir($base.'/phpmailer'),
  'env_vars_seen' => [
    'EMAIL_USER'  => (getenv('EMAIL_USER')  !== false && getenv('EMAIL_USER')  !== ''),
    'EMAIL_HOST'  => (getenv('EMAIL_HOST')  !== false && getenv('EMAIL_HOST')  !== ''),
    'GS_ENDPOINT' => (getenv('GS_ENDPOINT') !== false && getenv('GS_ENDPOINT') !== ''),
  ],
], JSON_PRETTY_PRINT);
