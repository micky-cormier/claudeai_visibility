<?php
$to = 'mickycorm@gmail.com';
$from = 'no-reply@greenbananaseo.com';
$subj = 'Mail() smoke test';
$body = '<b>mail()</b> works from llm-visibility-checker.';
$hdrs = "MIME-Version: 1.0\r\n".
        "Content-Type: text/html; charset=UTF-8\r\n".
        "From: No Reply <{$from}>\r\n";
$ok = @mail($to, $subj, $body, $hdrs, "-f {$from}");
var_dump(['ok'=>$ok]);