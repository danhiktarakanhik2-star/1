// Регистрация перехвата импортов для теста клиента.
// Запуск: node --import ./tf2/test/register-hooks.mjs ./tf2/test/client.mjs
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
