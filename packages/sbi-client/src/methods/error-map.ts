export const SBI_SERVER_ERROR_MESSAGES: Record<string, string> = {
  ME0010: 'No data is available.',
  E_0001:
    'Access is currently unstable. Try logging in again later or use the desktop website or HYPER SBI.',
  E_0002: 'Communication failed. Check your network connection and try again.',
  E_0003: 'You were logged out because the session was inactive for 60 minutes. Sign in again.',
  E_0004: 'User name is required.',
  E_0005: 'Login password is required.',
  E_0007: 'The trading password is incorrect.',
  E_0008: 'The requested issue does not exist.',
  E_0009:
    'Login to this app is restricted. Remove the restriction from the SBI Securities website settings.',
  E_0010:
    'More than 1,000 cash position records cannot be displayed in this app. Check the desktop website.',
  E_0011:
    'More than 1,000 cash position records cannot be displayed in this app. Try the all-records view.',
  E_0012: 'Order quantity is required.',
  E_0013: 'Order price is required.',
  E_0014: 'Stop order trigger condition is required.',
  E_0015: 'Trading password is required.',
  E_0016:
    'More than 1,000 margin position records cannot be displayed in this app. Check the desktop website.',
  E_0017:
    'More than 1,000 margin position records cannot be displayed in this app. Try the all-records view.',
  E_0018: 'Issue name or issue code is required.',
  E_0019: 'There are no sellable cash shares.',
  E_0020: 'Failed to sync the watchlist. Sign in again to display the latest watchlist.',
  E_0021: 'No matching issues were found. Change the search criteria and try again.',
  E_0022:
    'More than 1,000 order inquiry records cannot be displayed in this app. Check the desktop website.',
  E_0023:
    'More than 1,000 open order records cannot be displayed in this app. Check the desktop website.',
  E_0024:
    'More than 1,000 same-day execution records cannot be displayed in this app. Check the desktop website.',
  E_0025: 'No data is available.',
  E_0026: 'There are no closeable long margin positions.',
  E_0027: 'There are no closeable short margin positions.',
  E_0028: 'Watchlist name is required.',
  E_0029: 'Too many issues matched, so all issues cannot be displayed.',
  E_0030: 'An unexpected error occurred while fetching board prices.',
  E_0031: 'The session timed out.',
  E_0032: 'An unexpected error occurred.',
  E_0033: 'A required parameter is missing.',
  E_0034: 'Settings could not be retrieved.',
  E_0035: 'A connection or read timeout occurred.',
  E_0036:
    'Order reception timed out. The order may already have been submitted; check order inquiry.',
  E_0038: 'There are no margin positions available for stock receipt.',
  E_0039: 'There are no margin positions available for stock delivery.',
  E_0040: 'The order quantity exceeds the maximum input quantity.',
  E_0041: 'Failed to update the watchlist. It will be synced with the latest watchlist.',
  E_0042: 'Failed to sync the watchlist. Sign in again to display the latest watchlist.',
  E_0043: 'The selected index cannot be displayed on a chart.',
  E_0044: 'The selected issue cannot be traded on the PTS market.',
  E_0045: 'Margin trade type is not selected.',
  E_0046: 'The selected value is invalid. Select it again.',
  E_0047: 'The order quantity is invalid. Enter a valid half-width numeric quantity.',
  E_0048:
    'Buying power may be insufficient to order all theme component issues. Return to order input to change quantities.',
  E_0049:
    'The NISA investment limit may be insufficient to order all theme component issues. Return to order input to change quantities.',
  E_0050: 'A search error occurred.',
  E_0051: 'No target data is available.',
  E_0052: 'No details match the conditions.',
  E_0053: 'Failed to retrieve registered issues. The registered issue feature is unavailable.',
  E_0054: 'No watchlist is registered. Create one from the edit button.',
  E_0055:
    'The registered issue limit is 50. Delete an issue from notification settings before adding another.',
  E_0056: 'The registered issue limit is 50. Delete an issue before adding another.',
  E_0057: 'This issue is already registered.',
  E_0058: 'No matching issue was found.',
  E_0059: 'No issue is registered. Add an issue from the edit icon.',
  E_0060: 'OCO1 price is required.',
  E_0061: 'OCO2 stop order trigger condition is required.',
  E_0062: 'OCO2 price is required.',
  E_0063: 'IFD2 price is required.',
  E_0064: 'IFD2 stop order trigger condition is required.',
  E_0065: 'Order quantity is invalid.',
  E_0066: 'Order price is invalid.',
  E_0067: 'Stop order trigger condition is invalid.',
  E_0068: 'OCO1 price is invalid.',
  E_0069: 'OCO2 stop order trigger condition is invalid.',
  E_0070: 'OCO2 price is invalid.',
  E_0071: 'IFD2 price is invalid.',
  E_0072: 'IFD2 stop order trigger condition is invalid.',
  E_0073: 'Target value is required.',
  E_0074: 'Password reset is required. Complete the reset procedure on the website.',
  E_0075: 'An error occurred. Wait a while and try again.',
  E_0076:
    'Registering a new FIDO smartphone authentication credential will disable the previous one.',
  E_0077: 'Signed in with FIDO smartphone authentication.',
  E_0078:
    'FIDO smartphone authentication is not complete. Scan the QR code with the SBI Securities Smart App on another device, complete authentication, and try again.',
  E_0079: 'An error occurred. Start again from login.',
  E_0080: 'Login from an invalid device was detected. The app will exit.',
  E_0081:
    'Identity verification is not complete. Call the authentication phone number from the registered phone number.',
  E_0082: 'The request expired. Start the procedure again.',
  E_0083: 'An error occurred. Wait a while and try again.',
}

export type SbiServerErrorOptions = {
  code: string
  status?: string
  serverMessage?: string
  trCode?: string
  requestUrl?: string
}

export class SbiServerError extends Error {
  readonly code: string
  readonly status?: string
  readonly serverMessage?: string
  readonly englishMessage: string
  readonly trCode?: string
  readonly requestUrl?: string

  constructor(options: SbiServerErrorOptions) {
    const englishMessage = getSbiServerErrorMessage(options.code)
    const serverMessage = options.serverMessage ? ` Server message: ${options.serverMessage}` : ''
    super(`SBI server error ${options.code}: ${englishMessage}${serverMessage}`)
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'SbiServerError'
    this.code = options.code
    this.status = options.status
    this.serverMessage = options.serverMessage
    this.englishMessage = englishMessage
    this.trCode = options.trCode
    this.requestUrl = options.requestUrl
  }
}

export const getSbiServerErrorMessage = (code: string) =>
  SBI_SERVER_ERROR_MESSAGES[code] ?? `SBI server returned error code ${code}.`
