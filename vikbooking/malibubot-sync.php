<?php
/**
 * Sincronizacion de reservas de Vik Booking para MALIBUBOT (solo lectura).
 *
 * Por que existe: la pasarela malibubot.php solo avisa cuando Vik Booking la
 * llama, y Vik no siempre lo hace con las reservas que llegan de Booking.com o
 * Expedia. Este archivo deja que MALIBUBOT LEA directamente las reservas de
 * Vik Booking cada pocos minutos, vengan de donde vengan.
 *
 * INSTALAR (una sola vez):
 *  1. Sube este archivo a la RAIZ de la web (la misma carpeta donde esta el
 *     archivo configuration.php de Joomla), con el nombre malibubot-sync.php.
 *  2. La clave: escribe en la linea "$CLAVE = '...';" (mas abajo) la misma clave que
 *     VIK_SYNC_KEY en Render. Es el UNICO lugar del archivo que se edita.
 *  3. En Render agrega VIK_SYNC_KEY (la clave) y VIK_SYNC_URL con el valor
 *     https://www.hotelmalibu.co/malibubot-sync.php
 *
 * Seguridad: solo responde si llega la cabecera X-Malibubot-Key correcta; es de
 * solo lectura (SELECT) y NO devuelve datos de pago.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// ---- CAMBIAR SOLO ESTO: misma clave que VIK_SYNC_KEY en Render ----
$CLAVE = 'PEGAR_AQUI_LA_CLAVE';
// -------------------------------------------------------------

function salir($codigo, $datos)
{
	http_response_code($codigo);
	echo json_encode($datos);
	exit;
}

$recibida = isset($_SERVER['HTTP_X_MALIBUBOT_KEY']) ? (string) $_SERVER['HTTP_X_MALIBUBOT_KEY'] : '';
if ($recibida === '') {
	salir(403, array('ok' => false, 'error' => 'Falta la clave.'));
}

$config = __DIR__ . '/configuration.php';
if (!is_file($config)) {
	salir(500, array('ok' => false, 'error' => 'No encuentro configuration.php: sube este archivo a la raiz de Joomla.'));
}
require_once $config;
if (!class_exists('JConfig')) {
	salir(500, array('ok' => false, 'error' => 'configuration.php no define JConfig.'));
}
$c = new JConfig();

date_default_timezone_set('America/Bogota');
mysqli_report(MYSQLI_REPORT_OFF);

// Servidor y puerto ("localhost", "localhost:3306" o "127.0.0.1:3307").
$host = (string) $c->host;
$port = 3306;
if (strpos($host, ':') !== false) {
	$partes = explode(':', $host, 2);
	$host = $partes[0];
	if (ctype_digit($partes[1])) {
		$port = (int) $partes[1];
	}
}
$db = @new mysqli($host, (string) $c->user, (string) $c->password, (string) $c->db, $port);
if ($db->connect_errno) {
	salir(500, array('ok' => false, 'error' => 'No pude conectar a la base de datos de Joomla.'));
}
$db->set_charset('utf8mb4');

$p = preg_replace('/[^A-Za-z0-9_]/', '', (string) $c->dbprefix);

// La clave debe escribirse en la linea de arriba ($CLAVE).
$CLAVE = trim($CLAVE);
if ($CLAVE === '' || strpos($CLAVE, 'PEGAR_AQUI') === 0) {
	salir(503, array('ok' => false, 'error' => 'Falta escribir la clave en la linea $CLAVE del archivo.'));
}
if (!hash_equals($CLAVE, $recibida)) {
	salir(403, array('ok' => false, 'error' => 'Clave incorrecta (el archivo tiene ' . strlen($CLAVE) . ' caracteres y Render envio ' . strlen($recibida) . ').'));
}
$tOrd = '`' . $p . 'vikbooking_orders`';
$tOrdRooms = '`' . $p . 'vikbooking_ordersrooms`';
$tRooms = '`' . $p . 'vikbooking_rooms`';

// Columnas que existen de verdad (asi no se rompe si cambia la version de Vik).
$existen = array();
$r = $db->query('SHOW COLUMNS FROM ' . $tOrd);
if (!$r) {
	salir(500, array('ok' => false, 'error' => 'No existe la tabla de reservas de Vik Booking (prefijo "' . $p . '").'));
}
while ($f = $r->fetch_assoc()) {
	$existen[$f['Field']] = true;
}
$quiero = array('id', 'sid', 'ts', 'status', 'checkin', 'checkout', 'custdata', 'custmail', 'phone', 'total', 'idorderota', 'channel');
$cols = array();
foreach ($quiero as $q) {
	if (isset($existen[$q])) {
		$cols[] = '`' . $q . '`';
	}
}
if (!isset($existen['id'])) {
	salir(500, array('ok' => false, 'error' => 'La tabla de reservas no tiene columna id.'));
}

$desdeId = isset($_GET['desde_id']) ? (int) $_GET['desde_id'] : 0;
$limite = isset($_GET['limite']) ? (int) $_GET['limite'] : 200;
$limite = max(1, min(500, $limite));

$sql = 'SELECT ' . implode(',', $cols) . ' FROM ' . $tOrd . ' WHERE `id` > ' . $desdeId . ' ORDER BY `id` ASC LIMIT ' . $limite;
$res = $db->query($sql);
if (!$res) {
	salir(500, array('ok' => false, 'error' => 'Fallo la consulta de reservas.'));
}

$ordenes = array();
$maxId = $desdeId;
while ($o = $res->fetch_assoc()) {
	$id = (int) $o['id'];
	$maxId = max($maxId, $id);

	// Nombre y apellidos desde "custdata" (lineas "Nombre: ..." y "Apellidos: ...").
	$first = '';
	$last = '';
	if (!empty($o['custdata'])) {
		foreach (preg_split('/\r?\n/', (string) $o['custdata']) as $line) {
			if (strpos($line, ':') === false) {
				continue;
			}
			$partes = array_map('trim', explode(':', $line, 2));
			$label = strtolower($partes[0]);
			if ($first === '' && ($label === 'nombre' || $label === 'name' || $label === 'first name')) {
				$first = $partes[1];
			}
			if ($last === '' && ($label === 'apellidos' || $label === 'apellido' || $label === 'last name' || $label === 'surname')) {
				$last = $partes[1];
			}
		}
	}
	$name = trim($first . ' ' . $last);

	// Habitaciones y huespedes.
	$rooms = array();
	$rr = $db->query('SELECT r.name AS name, orr.adults AS adults, orr.children AS children FROM ' . $tOrdRooms . ' AS orr LEFT JOIN ' . $tRooms . ' AS r ON r.id = orr.idroom WHERE orr.idorder = ' . $id);
	if ($rr) {
		while ($row = $rr->fetch_assoc()) {
			$rooms[] = array(
				'name'     => (string) $row['name'],
				'adults'   => (int) $row['adults'],
				'children' => (int) $row['children'],
			);
		}
	}

	$checkin = isset($o['checkin']) ? (int) $o['checkin'] : 0;
	$checkout = isset($o['checkout']) ? (int) $o['checkout'] : 0;
	$ordenes[] = array(
		'id'          => $id,
		'sid'         => isset($o['sid']) ? (string) $o['sid'] : '',
		'ts'          => isset($o['ts']) ? (int) $o['ts'] : 0,
		'phone'       => isset($o['phone']) ? (string) $o['phone'] : '',
		'name'        => $name,
		'checkin'     => $checkin ? date('Y-m-d', $checkin) : '',
		'checkout'    => $checkout ? date('Y-m-d', $checkout) : '',
		'checkin_ts'  => $checkin,
		'checkout_ts' => $checkout,
		'ota'         => isset($o['idorderota']) ? (string) $o['idorderota'] : '',
		'channel'     => isset($o['channel']) ? (string) $o['channel'] : '',
		'status'      => isset($o['status']) ? (string) $o['status'] : 'confirmed',
		'email'       => isset($o['custmail']) ? (string) $o['custmail'] : '',
		'total'       => isset($o['total']) ? (float) $o['total'] : 0,
		'rooms'       => $rooms,
	);
}

salir(200, array(
	'ok'        => true,
	'ordenes'   => $ordenes,
	'siguiente' => $maxId,
	'columnas'  => array_keys($existen),
));
