// ============================================================
//  Перехват импорта 'three' → заглушка (для теста клиента в Node).
// ============================================================
import { pathToFileURL } from 'node:url';

const STUB_URL = new URL('./stub-three.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: STUB_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
