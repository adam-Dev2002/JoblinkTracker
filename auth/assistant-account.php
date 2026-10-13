<?php
function assistantAccountContext(PDO $pdo, int $userId): array {
    $query = $pdo->prepare("SELECT kind, payload FROM workspace_items WHERE user_id = ? AND kind IN ('application','task','event') ORDER BY id DESC");
    $query->execute([$userId]);
    $context = ['applicationStatusCounts' => [], 'applications' => [], 'taskStatusCounts' => [], 'tasks' => [], 'events' => []];
    foreach ($query->fetchAll() as $record) {
        $data = json_decode($record['payload'], true);
        if (!is_array($data)) continue;
        $kind = $record['kind'];
        if ($kind === 'application' && ($data['status'] ?? '') === 'Application opened') $data['status'] = 'Saved';
        if ($kind === 'application' || $kind === 'task') {
            $key = $kind === 'application' ? 'applicationStatusCounts' : 'taskStatusCounts';
            $status = $data['status'] ?? 'Unknown';
            $context[$key][$status] = ($context[$key][$status] ?? 0) + 1;
        }
        $list = $kind === 'application' ? 'applications' : ($kind === 'task' ? 'tasks' : 'events');
        if ($list !== 'events' && count($context[$list]) >= 40) continue;
        $fields = $kind === 'application' ? ['title','company','status','date'] : ($kind === 'task' ? ['title','status','date'] : ['title','date','time']);
        $row = [];
        foreach ($fields as $field) $row[$field] = mb_substr((string)($data[$field] ?? ''), 0, 160);
        $context[$list][] = $row;
    }
    $today = (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');
    $context['events'] = array_values(array_filter($context['events'], fn($entry) => $entry['date'] >= $today));
    usort($context['events'], fn($a, $b) => ($a['date'] . $a['time']) <=> ($b['date'] . $b['time']));
    $context['events'] = array_slice($context['events'], 0, 40);
    return $context;
}
function accountSummary(array $context): string {
    $counts = $context['applicationStatusCounts'];
    $lines = ['Here is your current Joblink account summary:', 'Tracked jobs: ' . array_sum($counts)];
    foreach (['Saved','Unavailable','Applied','Interview','Offer','Rejected','Ghosted'] as $status) $lines[] = $status . ': ' . ($counts[$status] ?? 0);
    $interviews = array_filter($context['applications'], fn($entry) => $entry['status'] === 'Interview');
    if ($interviews) {
        $lines[] = "\nRecent jobs marked Interview:";
        foreach (array_slice($interviews, 0, 5) as $entry) $lines[] = '- ' . $entry['title'] . ($entry['company'] ? ' at ' . $entry['company'] : '');
    }
    $today = (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');
    $events = array_filter($context['events'], fn($entry) => $entry['date'] >= $today);
    usort($events, fn($a, $b) => ($a['date'] . $a['time']) <=> ($b['date'] . $b['time']));
    $lines[] = "\nUpcoming saved events:";
    if (!$events) $lines[] = 'No upcoming events saved in your calendar.';
    foreach (array_slice($events, 0, 5) as $entry) $lines[] = '- ' . $entry['title'] . ' — ' . $entry['date'] . ($entry['time'] ? ' ' . $entry['time'] . ' Manila time' : '');
    $lines[] = "\nOpen tasks: " . (array_sum($context['taskStatusCounts']) - ($context['taskStatusCounts']['Done'] ?? 0));
    $lines[] = 'These are your saved records. An Interview status does not establish a scheduled interview time; use the calendar to save that date.';
    return implode("\n", $lines);
}
