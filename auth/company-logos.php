<?php
function companyLogo(string $company, string $provided): string {
    global $config;
    static $brands = null;
    $brands ??= json_decode(file_get_contents(__DIR__ . '/company-brands.json'), true);
    $name = mb_strtolower(trim($company));
    if (!empty($brands[$name]['logo'])) return $brands[$name]['logo'];
    if (!empty($config['brandfetch_client_id'])) {
        try {
            $matches = cachedFeed('company-brand:' . $name, 'https://api.brandfetch.io/v2/search/' . rawurlencode(trim($company)) . '?c=' . rawurlencode($config['brandfetch_client_id']), [], 604800);
            foreach ($matches as $match) {
                if (mb_strtolower(trim($match['name'] ?? '')) === $name && safeJobUrl($match['icon'] ?? '')) return $match['icon'];
            }
        } catch (Throwable $e) { /* Logo lookup must not break job search. */ }
    }
    return $provided;
}
