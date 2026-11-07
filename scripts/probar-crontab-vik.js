// probar-crontab-vik.js — El bot llama a la tarea programada de Vik Booking (web FALSA). node scripts/probar-crontab-vik.js
import http from 'http';
let codigo = 200, vistas = [];
const web = await new Promise((r) => { const s = http.createServer((q, res) => { vistas.push(q.url + '|' + q.headers['user-agent']); res.statusCode = codigo; res.end('ok'); }); s.listen(0, () => r(s)); });
process.env.VIK_CRONTAB_URL = `http://127.0.0.1:${web.address().port}/index.php?option=com_vikbooking&task=crontab`;
const { programarCrontab, llamarCrontab, estadoCrontab } = await import('../src/vikbooking/crontab.js');
let f = 0; const ok = (n, c, x = '') => { console.log((c ? '✅ ' : '❌ ') + n + (c ? '' : ' → ' + x)); if (!c) f++; };
programarCrontab();
ok('queda activo con la dirección de Vik', estadoCrontab().activo && /task=crontab/.test(estadoCrontab().url));
await llamarCrontab();
ok('llama a la dirección y lo anota', vistas.length === 1 && /task=crontab/.test(vistas[0]) && estadoCrontab().ok === true && estadoCrontab().http === 200, JSON.stringify(estadoCrontab()));
codigo = 500; await llamarCrontab();
ok('si la web falla lo anota con el motivo', estadoCrontab().ok === false && /500/.test(estadoCrontab().error) && estadoCrontab().fallos === 1);
web.close(); console.log(f ? `\n❌ ${f}` : '\n✅ Todo bien'); process.exit(f ? 1 : 0);
