<?php
return [
    'db_host' => '127.0.0.1', 'db_port' => 3306,
    'db_name' => 'jobscanner', 'db_user' => 'root', 'db_password' => '',
    'app_url' => 'http://localhost:3000',
    'google_client_id' => '', 'google_client_secret' => '',
    'google_redirect_uri' => 'http://localhost:3000/api/auth/google/callback',
    'cookie_secure' => false,
    'jsearch_api_key' => '',
    'brandfetch_client_id' => '',
    'assistant_provider' => 'gemini',
    'gemini_api_key' => '',
    'gemini_model' => 'gemini-3.1-flash-lite',
    'gemini_account_context' => 'disabled',
    'openai_api_key' => '',
    'openai_model' => 'gpt-4.1-mini',
    'assistant_web_search' => 'enabled',
];
