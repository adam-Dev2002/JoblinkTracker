<?php
// The router has already loaded configuration and started the session.
function workspaceRequest(PDO $pdo, string $path, string $method): never {
    global $config;
    $user = currentUser($pdo);
    if (!$user) respond(['error' => 'Sign in to use your workspace.'], 401);
    require_once __DIR__ . '/attachments.php';
    if ($path === '/api/workspace/attachments') attachmentRequest($pdo, $user, $method);
    if ($path !== '/api/workspace/items') respond(['error' => 'Not found'], 404);
    if ($method === 'GET') {
        $query = $pdo->prepare('SELECT id, kind, payload FROM workspace_items WHERE user_id = ? ORDER BY id DESC');
        $query->execute([$user['id']]);
        $items = array_map(fn($r) => ['id' => (int)$r['id'], 'kind' => $r['kind'], 'payload' => json_decode($r['payload'], true)], $query->fetchAll());
        $q=$pdo->prepare('SELECT id,item_id,name,mime,size FROM workspace_attachments WHERE user_id=?');$q->execute([$user['id']]);$attachments=$q->fetchAll();
        foreach($items as &$item) $item['attachments']=array_values(array_map(fn($a)=>['id'=>(int)$a['id'],'name'=>$a['name'],'mime'=>$a['mime'],'size'=>(int)$a['size']],array_filter($attachments,fn($a)=>(int)$a['item_id']===$item['id'])));unset($item);
        respond(['items' => $items]);
    }
    if ($method !== 'POST') respond(['error' => 'Method not allowed'], 405);
    if (!isSameOriginRequest()) respond(['error' => 'Invalid origin'], 403);
    if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) respond(['error' => 'Session expired. Refresh and try again.'], 403);
    if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) respond(['error' => 'JSON required'], 415);
    $raw = file_get_contents('php://input', false, null, 0, 16385);
    if (strlen($raw) > 16384) respond(['error' => 'Entry is too large.'], 413);
    $input = json_decode($raw, true);
    if (!is_array($input)) respond(['error' => 'Invalid entry.'], 422);
    $id = filter_var($input['id'] ?? 0, FILTER_VALIDATE_INT);
    if ($id === false || $id < 0) respond(['error' => 'Invalid entry ID.'], 422);
    if (($input['action'] ?? '') === 'bulk-delete') {
        $bulkKind=$input['kind']??'sheet';if(!in_array($bulkKind,['application','sheet'],true))respond(['error'=>'Invalid bulk-delete entry type.'],422);
        $ids=$input['ids']??null;if(!is_array($ids)||!$ids||count($ids)>200||array_filter($ids,fn($id)=>!is_int($id)||$id<1))respond(['error'=>'Select 1 to 200 valid rows.'],422);
        $ids=array_values(array_unique($ids));$marks=implode(',',array_fill(0,count($ids),'?'));$q=$pdo->prepare("SELECT id FROM workspace_items WHERE user_id=? AND kind=? AND id IN ($marks)");$q->execute(array_merge([$user['id'],$bulkKind],$ids));$owned=array_map('intval',$q->fetchAll(PDO::FETCH_COLUMN));if(count($owned)!==count($ids))respond(['error'=>'Some rows were not found. Nothing deleted.'],404);
        removeAttachmentFiles($pdo,$user['id'],$owned);$pdo->prepare("DELETE FROM workspace_items WHERE user_id=? AND kind=? AND id IN ($marks)")->execute(array_merge([$user['id'],$bulkKind],$ids));respond(['deleted'=>$owned]);
    }
    if (($input['action'] ?? '') === 'delete-status') {
        $q=$pdo->prepare("SELECT payload FROM workspace_items WHERE id=? AND user_id=? AND kind='task_status'");$q->execute([$id,$user['id']]);$status=$q->fetch();if(!$status)respond(['error'=>'Status not found'],404);
        $name=json_decode($status['payload'],true)['title'];$pdo->beginTransaction();
        try {
            $q=$pdo->prepare("SELECT id,payload FROM workspace_items WHERE user_id=? AND kind='task' FOR UPDATE");$q->execute([$user['id']]);$updated=[];
            foreach($q->fetchAll() as $row){$data=json_decode($row['payload'],true);if(($data['status']??'')!==$name)continue;$data['status']='To do';$pdo->prepare('UPDATE workspace_items SET payload=? WHERE id=? AND user_id=?')->execute([json_encode($data,JSON_THROW_ON_ERROR),$row['id'],$user['id']]);$updated[]=['id'=>(int)$row['id'],'kind'=>'task','payload'=>$data];}
            $pdo->prepare("DELETE FROM workspace_items WHERE id=? AND user_id=? AND kind='task_status'")->execute([$id,$user['id']]);$pdo->commit();
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        respond(['deleted'=>$id,'updated'=>$updated]);
    }
    if (($input['action'] ?? '') === 'delete') {
        if ($id < 1) respond(['error' => 'Invalid entry ID.'], 422);
        $q=$pdo->prepare("SELECT kind FROM workspace_items WHERE id=? AND user_id=?");$q->execute([$id,$user['id']]);if($q->fetchColumn()==='task_status')respond(['error'=>'Use delete-status to preserve the tasks in this column.'],422);
        removeAttachmentFiles($pdo,$user['id'],[$id]);
        $query = $pdo->prepare('DELETE FROM workspace_items WHERE id = ? AND user_id = ?'); $query->execute([$id, $user['id']]);
        if (!$query->rowCount()) respond(['error' => 'Entry not found.'], 404);
        respond(['ok' => true]);
    }
    $kind = $input['kind'] ?? '';
    $fields = ['application' => ['title','company','url','salary','status','notes','date','jobId','source','location','logo'], 'task' => ['title','status','date','notes'], 'task_status' => ['title'], 'event' => ['title','date','time','notes'], 'link' => ['title','url','notes'], 'sheet' => ['title','company','value','notes']];
    if (!is_string($kind) || !isset($fields[$kind]) || !is_array($input['payload'] ?? null)) respond(['error' => 'Invalid entry type.'], 422);
    $data = [];
    foreach ($fields[$kind] as $field) {
        $value = $input['payload'][$field] ?? '';
        if (!is_string($value) || mb_strlen($value) > ($field === 'notes' ? 4000 : (in_array($field, ['url', 'logo'], true) ? 2048 : 500))) respond(['error' => 'Check entry field length.'], 422);
        $data[$field] = trim($value);
    }
    if ($data['title'] === '') respond(['error' => 'A title is required.'], 422);
    if (!empty($data['logo']) && !preg_match('~^/static/company-logos/[a-z0-9._-]+\.(?:png|jpe?g|webp|svg|ico)$~i', $data['logo']) && (!filter_var($data['logo'], FILTER_VALIDATE_URL) || !in_array(parse_url($data['logo'], PHP_URL_SCHEME), ['http','https'], true) || parse_url($data['logo'], PHP_URL_USER) !== null || parse_url($data['logo'], PHP_URL_PASS) !== null)) respond(['error' => 'Use a valid company logo URL.'], 422);
    if (!empty($data['url']) && (!filter_var($data['url'], FILTER_VALIDATE_URL) || !in_array(parse_url($data['url'], PHP_URL_SCHEME), ['http','https'], true))) respond(['error' => 'Use a valid http or https URL.'], 422);
    if (!empty($data['date'])) {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $data['date']);
        if (!$date || $date->format('Y-m-d') !== $data['date']) respond(['error' => 'Use a valid date.'], 422);
    }
    if (!empty($data['time']) && !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $data['time'])) respond(['error' => 'Use a valid time.'], 422);
    if ($kind === 'application' && !in_array($data['status'], ['Saved','Application opened','Applied','Interview','Offer','Rejected','Ghosted'], true)) respond(['error' => 'Invalid application status.'], 422);
    $statuses=['To do','In progress','Done'];$q=$pdo->prepare("SELECT payload FROM workspace_items WHERE user_id=? AND kind='task_status'");$q->execute([$user['id']]);foreach($q->fetchAll() as $row)$statuses[]=json_decode($row['payload'],true)['title'];
    if ($kind === 'task' && !in_array($data['status'], $statuses, true)) respond(['error' => 'Invalid task status.'], 422);
    if($kind==='task_status'){
        if($id>0)respond(['error'=>'Status renaming is not supported.'],422);
        if(mb_strlen($data['title'])>40||count($statuses)>=15)respond(['error'=>'Use up to 40 characters and at most 12 custom statuses.'],422);
        foreach($statuses as $name)if(mb_strtolower($name)===mb_strtolower($data['title']))respond(['error'=>'That status already exists.'],409);
    }
    if (($input['action'] ?? '') === 'open-application') {
        if ($kind !== 'application' || empty($data['url'])) respond(['error' => 'A valid application URL is required.'], 422);
        $pdo->beginTransaction();
        try {
            $lock = $pdo->prepare('SELECT id FROM users WHERE id = ? FOR UPDATE'); $lock->execute([$user['id']]);
            $existing = $pdo->prepare("SELECT id, payload FROM workspace_items WHERE user_id = ? AND kind = 'application' AND (JSON_UNQUOTE(JSON_EXTRACT(payload, '$.url')) = ? OR (? <> '' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.jobId')) = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.source')) = ?)) LIMIT 1");
            $existing->execute([$user['id'], $data['url'], $data['jobId'], $data['jobId'], $data['source']]);
            $found = $existing->fetch();
            if ($found) {
                $id = (int)$found['id']; $data = json_decode($found['payload'], true);
                if (($data['status'] ?? '') === 'Saved') {
                    $data['status'] = 'Application opened';
                    $pdo->prepare('UPDATE workspace_items SET payload = ? WHERE id = ? AND user_id = ?')->execute([json_encode($data, JSON_THROW_ON_ERROR), $id, $user['id']]);
                }
            } else {
                $count = $pdo->prepare('SELECT COUNT(*) FROM workspace_items WHERE user_id = ?'); $count->execute([$user['id']]);
                if ((int)$count->fetchColumn() >= 2000) { $pdo->rollBack(); respond(['error' => 'Workspace limit reached.'], 422); }
                $data['status'] = 'Application opened';
                $pdo->prepare('INSERT INTO workspace_items (user_id, kind, payload) VALUES (?, ?, ?)')->execute([$user['id'], 'application', json_encode($data, JSON_THROW_ON_ERROR)]);
                $id = (int)$pdo->lastInsertId();
            }
            $pdo->commit();
        } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
        respond(['item' => ['id' => $id, 'kind' => 'application', 'payload' => $data]]);
    }
    $payload = json_encode($data, JSON_THROW_ON_ERROR);
    if ($id > 0) {
        $owned = $pdo->prepare('SELECT id FROM workspace_items WHERE id = ? AND user_id = ? AND kind = ?'); $owned->execute([$id, $user['id'], $kind]);
        if (!$owned->fetch()) respond(['error' => 'Entry not found.'], 404);
        $pdo->prepare('UPDATE workspace_items SET payload = ? WHERE id = ? AND user_id = ?')->execute([$payload, $id, $user['id']]);
    } else {
        $count = $pdo->prepare('SELECT COUNT(*) FROM workspace_items WHERE user_id = ?'); $count->execute([$user['id']]);
        if ((int)$count->fetchColumn() >= 2000) respond(['error' => 'Workspace limit reached. Remove unused entries.'], 422);
        $pdo->prepare('INSERT INTO workspace_items (user_id, kind, payload) VALUES (?, ?, ?)')->execute([$user['id'], $kind, $payload]);
        $id = (int)$pdo->lastInsertId();
    }
    respond(['item' => ['id' => $id, 'kind' => $kind, 'payload' => $data]]);
}
