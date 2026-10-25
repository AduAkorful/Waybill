import { createPublicClient, http, fallback, parseAbi, defineChain } from 'viem'
const chain = defineChain({ id: 5042, name: 'Arc', nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18}, rpcUrls:{default:{http:['https://rpc.mainnet.arc.io']}}, contracts:{multicall3:{address:'0xcA11bde05977b3631167028862bE2a173976CA11'}}})
const c = createPublicClient({ chain, transport: fallback([http('https://waybill-relayer.onrender.com/v1/rpc'), http('https://rpc.mainnet.arc.io')],{rank:false}), batch:{multicall:{wait:25}} })
const abi = parseAbi(['function isAllowed(address) view returns (bool)', 'function feeUsdc(address) view returns (uint256)'])
const a='0x02595bECED23EBA03386d440a92d5e91263789EF', t='0x5EAf26805258F49620fDb1e6FD8Afd91D7a6460e'
const t0=Date.now()
console.log(await Promise.race([Promise.all([c.readContract({address:a,abi,functionName:'isAllowed',args:[t]}),c.readContract({address:a,abi,functionName:'feeUsdc',args:[t]})]), new Promise(r=>setTimeout(()=>r('TIMEOUT'),30000))]), Date.now()-t0)
