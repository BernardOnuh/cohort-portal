import axios from 'axios'

const BASE_URL = process.env.MONNIFY_BASE_URL
const API_KEY  = process.env.MONNIFY_API_KEY
const SECRET   = process.env.MONNIFY_SECRET_KEY
const CONTRACT = process.env.MONNIFY_CONTRACT_CODE

let _token = null
let _tokenExpiry = 0

/** Get (or refresh) a Monnify access token */
export async function getMonnifyToken() {
  if (_token && Date.now() < _tokenExpiry) return _token

  const credentials = Buffer.from(`${API_KEY}:${SECRET}`).toString('base64')
  const { data } = await axios.post(
    `${BASE_URL}/api/v1/auth/login`,
    {},
    { headers: { Authorization: `Basic ${credentials}` } }
  )

  _token = data.responseBody.accessToken
  // Monnify tokens last 1 hour — refresh 5 min early
  _tokenExpiry = Date.now() + 55 * 60 * 1000
  return _token
}

/**
 * Initialise a Monnify transaction
 * @param {object} opts
 * @param {number}  opts.amount        - Amount in Naira
 * @param {string}  opts.email         - Customer email
 * @param {string}  opts.name          - Customer name
 * @param {string}  opts.ref           - Your unique payment reference
 * @param {string}  opts.description   - Narration shown on payment page
 */
export async function initTransaction({ amount, email, name, ref, description }) {
  const token = await getMonnifyToken()

  const { data } = await axios.post(
    `${BASE_URL}/api/v1/merchant/transactions/init-transaction`,
    {
      amount,
      customerName: name,
      customerEmail: email,
      paymentReference: ref,
      paymentDescription: description,
      currencyCode: 'NGN',
      contractCode: CONTRACT,
      redirectUrl: process.env.MONNIFY_REDIRECT_URL || '',
      paymentMethods: ['CARD', 'ACCOUNT_TRANSFER'],
    },
    { headers: { Authorization: `Bearer ${token}` } }
  )

  return data.responseBody // { transactionReference, checkoutUrl, ... }
}

/**
 * Verify a completed transaction by its payment reference
 */
export async function verifyTransaction(paymentReference) {
  const token = await getMonnifyToken()
  const encoded = encodeURIComponent(paymentReference)

  const { data } = await axios.get(
    `${BASE_URL}/api/v2/transactions/${encoded}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  return data.responseBody // { paymentStatus, amountPaid, ... }
}