<?php
// Sheets-only collector (no email, no health, no LLM calls)
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function loadEnv($file='.env'){
  if (!is_readable($file)) return;
  foreach (file($file, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line){
    if ($line[0]==='#' || strpos($line,'=')===false) continue;
    [$k,$v] = explode('=',$line,2);
    putenv("$k=$v"); $_ENV[$k]=$v;
  }
}
loadEnv(__DIR__.'/.env');

$endpoint = getenv('GS_ENDPOINT') ?: '';
$secret   = getenv('GS_SECRET')   ?: '';

if (!$endpoint || stripos($endpoint,'PASTE_EXEC_URL')!==false) {
  http_response_code(500);
  echo json_encode(['ok'=>false,'error'=>'GS endpoint not configured']); exit;
}

// Accept JSON or form-encoded (safer vs WAF)
$ct = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
$raw = file_get_contents('php://input');
$data = [];
if (strpos($ct,'application/json') !== false) {
  $data = json_decode($raw, true);
  if (!is_array($data)) { http_response_code(400); echo json_encode(['ok'=>false,'error'=>'Invalid JSON']); exit; }
} else {
  $data = $_POST ?: [];
}

$payload = ['secret'=>$secret, 'payload'=>$data];

$ch = curl_init($endpoint);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
  CURLOPT_POSTFIELDS     => json_encode($payload),
  CURLOPT_TIMEOUT        => 15
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

// Optional: append raw leads to a local file as a belt-and-suspenders backup
@file_put_contents(__DIR__.'/leads.json',
  json_encode(['ts'=>date('c'),'lead'=>$data], JSON_UNESCAPED_SLASHES)."\n",
  FILE_APPEND
);

echo json_encode([
  'ok'     => ($code>=200 && $code<300),
  'status' => $code,
  'error'  => $err ?: null,
  'body'   => $resp
]);
