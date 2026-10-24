/** Unix seconds to stamp a statement with: the later of the device clock and the latest block. */
export async function statementTime(client: { getBlock: (a: { blockTag: 'latest' }) => Promise<{ timestamp: bigint }> } | undefined, deviceNow = Date.now()): Promise<bigint> {
  const device = BigInt(Math.floor(deviceNow / 1000))
  if (!client) return device
  try {
    const b = await client.getBlock({ blockTag: 'latest' })
    return b.timestamp > device ? b.timestamp : device
  } catch {
    return device
  }
}
