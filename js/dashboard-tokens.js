// ================================================
// TOKENS-DASHBOARD.JS — solo lo carga dashboard.html (el consolidado)
// ================================================
// Mismos valores que TOKENS_DEPARTAMENTO en gas/Code.gs — si cambian allá,
// cambiar también aquí. Sirve para que el dashboard consolidado arme los
// enlaces con token de "Enlaces por departamento" y para que sus propias
// pestañas puedan pedir un departamento puntual sin volver a escribir el
// token a mano.
//
// Las páginas dashboard-<departamento>.html NO cargan este archivo — cada
// una solo conoce su propio token, leído de la URL (?t=), nunca del código
// fuente. Así, alguien con el enlace de un solo departamento no puede ver
// los tokens de los otros tres mirando el código de su página.
const TOKENS_DEPARTAMENTO = {
  'Caldas': 'PQ3FTqLG5G469e',
  'Risaralda': '11awJ3W8cHkLtc',
  'Quindío': 'h3tGG2LAVd7ODX',
  'Valle del Cauca': 'yTfW8Rtjfw5iHD',
};
