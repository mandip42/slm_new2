/**
 * Product identity.
 *
 * One place, so the name on the home screen, the name Android shows under the
 * installed icon, the name in the window title and the name stamped into every
 * exported report can never drift apart.
 *
 * `APP_NAME` is the full product name and belongs anywhere the product is being
 * introduced: the home screen, the About screen, the manifest, report headers.
 * `APP_SHORT_NAME` is what Android has room for under a launcher icon and what
 * reads naturally mid-sentence.
 */

export const APP_NAME = 'WWDE NVH Sonoscope';

export const APP_SHORT_NAME = 'Sonoscope';

export const APP_TAGLINE = 'Calibrated acoustic and NVH measurement, on your phone';

export const AUTHOR_NAME = 'Mandip Goswami';

export const AUTHOR_EMAIL = 'gomandip@amazon.com';

/** Single line of credit, used at the bottom of the home screen and in reports. */
export const AUTHOR_CREDIT = `Built by ${AUTHOR_NAME}`;
