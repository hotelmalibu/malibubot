<?php
/**
 * Pasarela "MALIBUBOT" para Vik Booking (Joomla).
 *
 * En lugar de enviar un SMS, avisa a MALIBUBOT para que le escriba al huesped
 * por WhatsApp "Reserva confirmada" con su ingreso y salida.
 * Vik Booking usa esta pasarela en el momento en que una reserva pasa a
 * CONFIRMADA (pago recibido) si el envio automatico esta activado.
 *
 * Instalar en: /administrator/components/com_vikbooking/smsapi/malibubot.php
 * No consulta ni escribe nada en la base de datos: solo llama a MALIBUBOT.
 */
defined('_JEXEC') or defined('ABSPATH') or die('Restricted Access');

class VikSmsApi
{
	private $order_info;
	private $params;
	private $log = '';

	public static function getAdminParameters()
	{
		return array(
			'url' => array(
				'label' => 'URL de MALIBUBOT//Ej: https://malibubot.onrender.com/api/vik/confirmada',
				'type'  => 'text',
			),
			'key' => array(
				'label' => 'Clave//La misma VIK_WEBHOOK_KEY que esta en Render',
				'type'  => 'text',
			),
			'ignorar' => array(
				'label' => 'Celulares a ignorar//Numeros de administracion que reciben avisos internos (separados por coma). No se les envia el WhatsApp de huesped',
				'type'  => 'text',
			),
		);
	}

	public function __construct($order, $params = array())
	{
		$this->order_info = is_object($order) ? get_object_vars($order) : (is_array($order) ? $order : array());
		$this->params = is_array($params) ? $params : array();
	}

	public function sendMessage($phone_number, $msg_text)
	{
		$res = new stdClass;
		$res->httpcode = 0;
		$res->errmsg = '';
		$res->body = null;

		$url = trim((string) (isset($this->params['url']) ? $this->params['url'] : ''));
		$key = trim((string) (isset($this->params['key']) ? $this->params['key'] : ''));
		if ($url === '' || $key === '') {
			$res->errmsg = 'Falta la URL o la clave de MALIBUBOT';
			return $res;
		}

		// Celulares de administracion: Vik tambien avisa al hotel con la misma pasarela.
		$digits = preg_replace('/[^0-9]/', '', (string) $phone_number);
		$ignorar = isset($this->params['ignorar']) ? (string) $this->params['ignorar'] : '';
		foreach (explode(',', $ignorar) as $n) {
			$n = preg_replace('/[^0-9]/', '', $n);
			if ($n !== '' && $digits !== '' && substr($digits, -10) === substr($n, -10)) {
				$res->httpcode = 200;
				$res->body = (object) array('ok' => true, 'estado' => 'ignorado');
				return $res;
			}
		}

		date_default_timezone_set('America/Bogota');
		$o = $this->order_info;
		$checkin = isset($o['checkin']) ? (int) $o['checkin'] : 0;
		$checkout = isset($o['checkout']) ? (int) $o['checkout'] : 0;

		// Nombre: linea "Nombre: ..." de los datos del cliente.
		$name = '';
		if (!empty($o['custdata'])) {
			foreach (preg_split('/\r?\n/', (string) $o['custdata']) as $line) {
				if (strpos($line, ':') === false) {
					continue;
				}
				$parts = array_map('trim', explode(':', $line, 2));
				$label = strtolower($parts[0]);
				if ($label === 'nombre' || $label === 'name') {
					$name = $parts[1];
					break;
				}
			}
		}

		$payload = array(
			'id'          => isset($o['id']) ? (int) $o['id'] : 0,
			'sid'         => isset($o['sid']) ? (string) $o['sid'] : '',
			'ts'          => isset($o['ts']) ? (int) $o['ts'] : 0,
			'phone'       => (string) $phone_number,
			'name'        => $name,
			'checkin'     => $checkin ? date('Y-m-d', $checkin) : '',
			'checkout'    => $checkout ? date('Y-m-d', $checkout) : '',
			'checkin_ts'  => $checkin,
			'checkout_ts' => $checkout,
			'ota'         => isset($o['idorderota']) ? (string) $o['idorderota'] : '',
		);

		$ch = curl_init($url);
		curl_setopt_array($ch, array(
			CURLOPT_POST           => true,
			CURLOPT_POSTFIELDS     => json_encode($payload),
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_CONNECTTIMEOUT => 8,
			CURLOPT_TIMEOUT        => 25,
			CURLOPT_HTTPHEADER     => array(
				'Content-Type: application/json',
				'Accept: application/json',
				'X-Malibubot-Key: ' . $key,
			),
		));
		$raw = curl_exec($ch);
		$res->httpcode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
		if ($raw === false) {
			$res->errmsg = curl_error($ch);
		} else {
			$res->body = json_decode($raw);
		}
		curl_close($ch);

		return $res;
	}

	public function validateResponse($response_obj)
	{
		if (!is_object($response_obj)) {
			$this->log .= 'Respuesta vacia de MALIBUBOT. ';
			return false;
		}
		$http = isset($response_obj->httpcode) ? (int) $response_obj->httpcode : 0;
		$body = isset($response_obj->body) && is_object($response_obj->body) ? $response_obj->body : null;
		if ($http >= 200 && $http < 300 && $body && !empty($body->ok)) {
			return true;
		}
		$msg = $body && isset($body->error) ? $body->error : (isset($response_obj->errmsg) && $response_obj->errmsg !== '' ? $response_obj->errmsg : 'sin detalle');
		$this->log .= 'MALIBUBOT HTTP ' . $http . ' - ' . $msg . '. ';
		return false;
	}

	public function estimate($phone_number, $msg_text)
	{
		return 'Aviso por WhatsApp (MALIBUBOT)';
	}

	public function getLog()
	{
		return $this->log;
	}
}
