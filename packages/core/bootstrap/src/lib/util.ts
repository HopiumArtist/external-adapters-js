import { AdapterImplementation, AdapterRequest } from '@chainlink/types'
import { Decimal } from 'decimal.js'
import { flatMap, values, pick, omit } from 'lodash'
import objectHash from 'object-hash'
import { v4 as uuidv4 } from 'uuid'
import { CacheEntry } from './cache/types'

export const isObject = (o: unknown): boolean =>
  o !== null && typeof o === 'object' && Array.isArray(o) === false

export const isArray = (o: unknown): boolean =>
  o !== null && typeof o === 'object' && Array.isArray(o)

export const parseBool = (value: any): boolean => {
  if (!value) return false
  const _val = value.toString().toLowerCase()
  return (_val === 'true' || _val === 'false') && _val === 'true'
}

// convert string values into Numbers where possible (for incoming query strings)
export const toObjectWithNumbers = (obj: any) => {
  const toNumber = (v: any) => (isNaN(v) ? v : Number(v))
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toNumber(v)]))
}

// pick a random string from env var after splitting with the delimiter ("a&b&c" "&" -> choice(["a","b","c"]))
export const getRandomEnv = (name: string, delimiter = ',', prefix = ''): string | undefined => {
  const val = getEnv(name, prefix)
  if (!val) return val
  const items = val.split(delimiter)
  return items[Math.floor(Math.random() * items.length)]
}

// pick a random string from env var after splitting with the delimiter ("a&b&c" "&" -> choice(["a","b","c"]))
export const getRandomRequiredEnv = (
  name: string,
  delimiter = ',',
  prefix = '',
): string | undefined => {
  const val = getRequiredEnv(name, prefix)
  const items = val.split(delimiter)
  return items[Math.floor(Math.random() * items.length)]
}

// We generate an UUID per instance
export const uuid = (): string => {
  if (!process.env.UUID) process.env.UUID = uuidv4()
  return process.env.UUID
}

export const delay = (ms: number): Promise<number> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Return a value used for exponential backoff in milliseconds.
 * @example
 * exponentialBackOffMs(1,100,1000,2) === 100
 * exponentialBackOffMs(2,100,1000,2) === 200
 * exponentialBackOffMs(3,100,1000,2) === 400
 *
 * @param retryCount The amount of retries that have passed
 * @param interval The interval in ms
 * @param max The maximum back-off in ms
 * @param coefficient The base multiplier
 */
export const exponentialBackOffMs = (retryCount = 1, interval = 100, max = 1000, coefficient = 2) =>
  Math.min(max, interval * coefficient ** (retryCount - 1))

export const getWithCoalescing = async ({
  get,
  isInFlight,
  retries = 5,
  interval = () => 100,
}: {
  get: (retryCount: number) => Promise<CacheEntry | undefined>
  isInFlight: (retryCount: number) => Promise<boolean>
  retries: number
  interval: (retryCount: number) => number
}) => {
  const _self = async (_retries: number): Promise<undefined | CacheEntry> => {
    if (_retries === 0) return
    const retryCount = retries - _retries + 1
    const entry = await get(retryCount)
    if (entry) return entry
    const inFlight = await isInFlight(retryCount)
    if (!inFlight) return
    await delay(interval(retryCount))
    return await _self(_retries - 1)
  }
  return await _self(retries)
}

const getEnvName = (name: string, prefix = '') => {
  const envName = prefix ? `${prefix}_${name}` : name
  if (!isEnvNameValid(envName))
    throw Error(`Invalid environment var name: ${envName}. Only '/^[_a-z0-9]+$/i' is supported.`)
  return envName
}

// Only case-insensitive alphanumeric and underscore (_) are allowed for env vars
const isEnvNameValid = (name: string) => /^[_a-z0-9]+$/i.test(name)

export const getEnv = (name: string, prefix = ''): string | undefined => {
  const envVar = process.env[getEnvName(name, prefix)]
  return envVar === '' ? undefined : envVar
}

// Custom error for required env variable.
export class RequiredEnvError extends Error {
  constructor(name: string) {
    super(`Please set the required env ${name}.`)
    this.name = RequiredEnvError.name
  }
}

/**
 * Get variable from environments
 * @param name The name of environment variable
 * @param prefix A string to add before the environment variable name
 * @throws {RequiredEnvError} Will throw an error if environment variable is not defined.
 * @returns {string}
 */
export const getRequiredEnv = (name: string, prefix = ''): string => {
  const val = getEnv(name, prefix)
  if (!val) throw new RequiredEnvError(getEnvName(name, prefix))
  return val
}

/**
 * @description
 * Takes an Array<V>, and a grouping function,
 * and returns a Map of the array grouped by the grouping function.
 *
 * @param list An array of type V.
 * @param keyGetter A Function that takes the the Array type V as an input, and returns a value of type K.
 *                  K is generally intended to be a property key of V.
 *
 * @returns Map of the array grouped by the grouping function.
 */
export function groupBy<K, V>(list: Array<V>, keyGetter: (input: V) => K): Map<K, Array<V>> {
  const map = new Map<K, Array<V>>()
  list.forEach((item) => {
    const key = keyGetter(item)
    const collection = map.get(key)
    if (!collection) {
      map.set(key, [item])
    } else {
      collection.push(item)
    }
  })
  return map
}

/**
 * Predicate used to find adapter by name
 *
 * @param name string adapter name
 */
export const byName =
  (name?: string) =>
  (a: AdapterImplementation): boolean =>
    a.NAME.toUpperCase() === name?.toUpperCase()

/**
 * Covert number to max number of decimals, trim trailing zeros
 *
 * @param num number to convert to fixed max number of decimals
 * @param decimals max number of decimals
 */
export const toFixedMax = (num: number | string | Decimal, decimals: number): string =>
  new Decimal(num)
    .toFixed(decimals)
    // remove trailing zeros
    .replace(/(\.\d*?[1-9])0+$/g, '$1')
    // remove decimal part if all zeros (or only decimal point)
    .replace(/\.0*$/g, '')

/** Common keys within adapter requests that should be ignored to generate a stable key*/
export const excludableAdapterRequestProperties: Record<string, true> = [
  'id',
  'maxAge',
  'meta',
  'debug',
  'rateLimitMaxAge',
  'metricsMeta',
]
  .concat((process.env.CACHE_KEY_IGNORED_PROPS || '').split(',').filter((k) => k))
  .reduce((prev, next) => {
    prev[next] = true
    return prev
  }, {} as Record<string, true>)

/** Common keys within adapter requests that should be used to generate a stable key*/
export const includableAdapterRequestProperties: string[] = ['data'].concat(
  (process.env.CACHE_KEY_INCLUDED_PROPS || '').split(',').filter((k) => k),
)

/** Common keys within adapter requests that should be ignored within "data" to create a stable key*/
const excludableInternalAdapterRequestProperties = [
  'resultPath',
  'overrides',
  'tokenOverrides',
  'includes',
]

export const getKeyData = (data: AdapterRequest) =>
  omit(
    pick(data, includableAdapterRequestProperties),
    excludableInternalAdapterRequestProperties.map((property) => `data.${property}`),
  )

export type HashMode = 'include' | 'exclude'
/**
 * Generates a key by hashing input data
 *
 * @param data Adapter request input data
 * @param hashOptions Additional configuration for the objectHash package
 * @param mode Which behavior to use:
 *    include (default) - hash only selected properties throwing out everything else
 *    exclude           - hash the entire data object after excluding certain properties
 *
 * @returns string
 */
export const hash = (
  data: AdapterRequest,
  hashOptions: Required<Parameters<typeof objectHash>>['1'],
  mode: HashMode = 'include',
): string => {
  return mode === 'include' || !data
    ? objectHash(getKeyData(data), hashOptions)
    : objectHash(data, getHashOpts())
}

export const getHashOpts = (): Required<Parameters<typeof objectHash>>['1'] => ({
  algorithm: 'sha1',
  encoding: 'hex',
  unorderedSets: false,
  respectType: false,
  respectFunctionProperties: false,
  respectFunctionNames: false,
  excludeKeys: (props: string) => excludableAdapterRequestProperties[props],
})

// Helper to identify if debug mode is running
export const isDebug = (): boolean => {
  return parseBool(process.env.DEBUG) || process.env.NODE_ENV === 'development'
}

// Helper to identify if debug log level is set
export const isDebugLogLevel = (): boolean => {
  return process.env.LOG_LEVEL === 'debug'
}

/**
 * @description Calculates all possible permutations without repetition of a certain size.
 *
 * @param collection A collection of distinct values to calculate the permutations from.
 * @param n The number of values to combine.
 *
 * @returns Array of permutations
 */
const permutations = (collection: any, n: any) => {
  const array = values(collection)
  if (array.length < n) return []

  const recur = (array: any, n: any) => {
    if (--n < 0) return [[]]

    const permutations: any[] = []
    array.forEach((value: any, index: any, array: any) => {
      array = array.slice()
      array.splice(index, 1)
      recur(array, n).forEach((permutation) => {
        permutation.unshift(value)
        permutations.push(permutation)
      })
    })
    return permutations
  }
  return recur(array, n)
}

/**
 * @description
 * Builds a permutation set from a list of options
 *
 * @param options The options to create a permutation from
 * @param delimiter (Optional) Joins the permutation results to a string
 *
 * @returns Array of permutations
 */
export const permutator = (options: string[], delimiter?: string): string[] | string[][] => {
  const output: string[][] = flatMap(options, (_: any, i: any, a: any) => permutations(a, i + 1))
  const join = (combos: string[][]) => combos.map((p) => p.join(delimiter))
  return typeof delimiter === 'string' ? join(output) : output
}

/**
 * @description
 * Check existing (non-undefined) value for its type.
 *
 * @url
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#real-world_usage
 *
 * @param value The value to type check
 * @param fullClass (Optional) Whether to use polyfill for checking null
 *
 * @returns String describing type of obj
 */
export function deepType(value: unknown, fullClass?: boolean): string {
  // get toPrototypeString() of obj (handles all types)
  // Early JS environments return '[object Object]' for null, so it's best to directly check for it.
  if (fullClass) {
    return value === null ? '[object Null]' : Object.prototype.toString.call(value)
  }
  if (value == null) {
    return (value + '').toLowerCase()
  } // implicit toString() conversion

  const deepType = Object.prototype.toString.call(value).slice(8, -1).toLowerCase()
  if (deepType === 'generatorfunction') {
    return 'function'
  }

  // Prevent overspecificity (for example, [object HTMLDivElement], etc).
  // Account for functionish Regexp (Android <=2.3), functionish <object> element (Chrome <=57, Firefox <=52), etc.
  // String.prototype.match is universally supported.

  return deepType.match(/^(array|bigint|date|error|function|generator|regexp|symbol)$/)
    ? deepType
    : typeof value === 'object' || typeof value === 'function'
    ? 'object'
    : typeof value
}

export const LEGACY_ENV_ADAPTER_URL = 'DATA_PROVIDER_URL'
export const ENV_ADAPTER_URL = 'ADAPTER_URL'

export const getURL = (prefix: string, required = false): string | undefined =>
  required
    ? getRequiredURL(prefix)
    : getEnv(ENV_ADAPTER_URL, prefix) || getEnv(LEGACY_ENV_ADAPTER_URL, prefix)

export const getRequiredURL = (prefix: string): string =>
  getRequiredEnv(ENV_ADAPTER_URL, prefix) || getRequiredEnv(LEGACY_ENV_ADAPTER_URL, prefix)

/**
 * Get variable from environment then check for a fallback if it is not set then throw if neither are set
 * @param primary The name of environment variable to look for first
 * @param prefix A string to add before the environment variable name
 * @param fallbacks The subsequent names of environment variables to look for if the primary is not found
 * @throws {RequiredEnvError} Will throw an error if environment variable is not defined.
 * @returns {string}
 */
export const getRequiredEnvWithFallback = (
  primary: string,
  fallbacks: string[],
  prefix = '',
): string => {
  // Attempt primary
  const val = getEnv(primary, prefix)
  if (val) return val

  // Attempt fallbacks
  for (const fallback of fallbacks) {
    const val = getEnv(fallback, prefix)
    if (val) return val
  }

  throw new RequiredEnvError(getEnvName(primary, prefix))
}
