'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi';
import { useDepositWithdraw } from '../contexts/DepositWithdrawContext';
import { useModal } from '../contexts/ModalContext';
import { LiFiSDK, SUPPORTED_CHAINS, ChainOption } from '../lib/LiFiSDK';
import { getChainBalance } from '../lib/chainBalances';
import { ethers } from 'ethers';
import { CONTRACTS } from '../config/contracts';
import CustomBridge from './CustomBridge';
import type { Route } from '@lifi/sdk';

// Wrapper contract address - tokens will be bridged directly here
const WRAPPER_CONTRACT = CONTRACTS.WRAPPER;

// USDTO address on HyperEVM
const USDTO_ADDRESS = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb';

// ABI for depositForUser function
const WRAPPER_ABI = [
  'function depositForUser(uint256 _amount, address _user) external'
];

// Define available tokens per chain with Trustwallet logos
const CHAIN_TOKENS: Record<number, Array<{ symbol: string; address: string; decimals: number; logo?: string }>> = {
  1: [ // Ethereum
    { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png' },
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
    { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png' },
    { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png' },
    { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png' },
    { symbol: 'LINK', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png' },
    { symbol: 'UNI', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984/logo.png' },
    { symbol: 'AAVE', address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9/logo.png' },
    { symbol: 'CRV', address: '0xD533a949740bb3306d119CC777fa900bA034cd52', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xD533a949740bb3306d119CC777fa900bA034cd52/logo.png' },
    { symbol: 'LDO', address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32/logo.png' },
    { symbol: 'MATIC', address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0/logo.png' },
    { symbol: 'SHIB', address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE/logo.png' },
    { symbol: 'APE', address: '0x4d224452801ACEd8B2F0aebE155379bb5D594381', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x4d224452801ACEd8B2F0aebE155379bb5D594381/logo.png' },
    { symbol: 'MKR', address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2/logo.png' },
    { symbol: 'SNX', address: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F/logo.png' },
    { symbol: 'COMP', address: '0xc00e94Cb662C3520282E6f5717214004A7f26888', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xc00e94Cb662C3520282E6f5717214004A7f26888/logo.png' },
    { symbol: 'SUSHI', address: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B3595068778DD592e39A122f4f5a5cF09C90fE2/logo.png' },
    { symbol: '1INCH', address: '0x111111111117dC0aa78b770fA6A738034120C302', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x111111111117dC0aa78b770fA6A738034120C302/logo.png' },
    { symbol: 'ENS', address: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72/logo.png' },
    { symbol: 'FRAX', address: '0x853d955aCEf822Db058eb8505911ED77F175b99e', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x853d955aCEf822Db058eb8505911ED77F175b99e/logo.png' },
    { symbol: 'stETH', address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84/logo.png' },
    { symbol: 'rETH', address: '0xae78736Cd615f374D3085123A210448E74Fc6393', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xae78736Cd615f374D3085123A210448E74Fc6393/logo.png' },
    { symbol: 'cbETH', address: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xBe9895146f7AF43049ca1c1AE358B0541Ea49704/logo.png' },
    { symbol: 'PEPE', address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6982508145454Ce325dDbE47a25d4ec3d2311933/logo.png' },
  ],
  42161: [ // Arbitrum
    { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
    { symbol: 'USDT', address: '0x6ab707Aca953eDAeFBc4fD23bA73294241490620', decimals: 6, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0x6ab707Aca953eDAeFBc4fD23bA73294241490620/logo.png' },
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0xaf88d065e77c8cC2239327C5EDb3A432268e5831/logo.png' },
    { symbol: 'USDC.e', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8/logo.png' },
    { symbol: 'ARB', address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0x912CE59144191C1204E64559FE8253a0e49E6548/logo.png' },
    { symbol: 'WETH', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0x82aF49447D8a07e3bd95BD0d56f35241523fBab1/logo.png' },
    { symbol: 'WBTC', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f/logo.png' },
    { symbol: 'DAI', address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1/logo.png' },
    { symbol: 'LINK', address: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0xf97f4df75117a78c1A5a0DBb814Af92458539FB4/logo.png' },
    { symbol: 'UNI', address: '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0/logo.png' },
    { symbol: 'GMX', address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a/logo.png' },
    { symbol: 'MAGIC', address: '0x539bdE0d7Dbd336b79148AA742883198BBF60342', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0x539bdE0d7Dbd336b79148AA742883198BBF60342/logo.png' },
    { symbol: 'RDNT', address: '0x3082CC23568eA640225c2467653dB90e9250AaA0', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0x3082CC23568eA640225c2467653dB90e9250AaA0/logo.png' },
    { symbol: 'PENDLE', address: '0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8/logo.png' },
    { symbol: 'GRT', address: '0x9623063377AD1B27544C965cCd7342f7EA7e88C7', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0x9623063377AD1B27544C965cCd7342f7EA7e88C7/logo.png' },
  ],
  999: [ // HyperEVM - All tokens from LiFi
    { symbol: 'HYPE', address: '0x0000000000000000000000000000000000000000', decimals: 18, logo: '/image.png' },
    { symbol: 'USDTO', address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', decimals: 6, logo: '/USDT0.jpg' },
    { symbol: 'wHYPE', address: '0x2831775cb5e64B1D892853893858A261E898FbEb', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/hyper/0b3e288cfe418e9ce69eef4c96374583.png' },
    { symbol: 'ETH', address: '0x1fbcCdc677c10671eE50b46C61F0f7d135112450', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
    { symbol: 'USDC', address: '0x6c3ea45f3a38b1a9b0f4bffcef74b1cd3f1e0d5a', decimals: 6, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
    { symbol: 'USDe', address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34/2b2f84856552421d8305bbc71db49979.png' },
    { symbol: 'UETH', address: '0xBe6727B535545C67d5cAa73dEa54865B92CF7907', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xbe6727b535545c67d5caa73dea54865b92cf7907/c3d23de18dc7c3c3c77208c886e8e392.png' },
    { symbol: 'UBTC', address: '0x0555e30da8f98308eDb960aa94c0db47230d2b9c', decimals: 8, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x0555e30da8f98308edb960aa94c0db47230d2b9c/d3c52e7c7449afa8bd4fad1c93f50d93.png' },
    { symbol: 'PURR', address: '0x9b498C3c8A0b8CD8BA1D9851d40D186F1872b44E', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x9b498c3c8a0b8cd8ba1d9851d40d186f1872b44e/f24d47ea475bd86c3f1c8289191c1b64.png' },
    { symbol: 'LINK', address: '0x1AC2EE68b8d038C982C1E1f73F596927dd70De59', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png' },
    { symbol: 'weETH', address: '0xA3D68b74bF0528fdD07263c60d6488749044914b', decimals: 18, logo: 'https://static.debank.com/image/uni_token/logo_url/0x7dcc39b4d1c53cb31e1abc0e358b43987fef80f7/6c02f6b3bcd264d433c3676100ad8da6.png' },
    { symbol: 'XAUt0', address: '0xf4D9235269a96aaDaFc9aDAe454a0618eBE37949', decimals: 6, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xf4d9235269a96aadafc9adae454a0618ebe37949/385aafbcccaaf39039b3b659703445c3.png' },
    { symbol: 'ENA', address: '0x58538e6A46E07434d7E7375Bc268D3cb839C0133', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x58538e6a46e07434d7e7375bc268d3cb839c0133/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'cmETH', address: '0xe6829d9a7ee3040e1276fa75293bde931859e8fa', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xe6829d9a7ee3040e1276fa75293bde931859e8fa/e32fe58963f8c6711bbe52e8fd75adbe.png' },
    { symbol: 'frxETH', address: '0x43eDD7f3831b08FE70B7555ddD373C8bF65a9050', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x43edd7f3831b08fe70b7555ddd373c8bf65a9050/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'APE', address: '0xab11329560Fa9c9c860bb21a9342215a1265BBB0', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xab11329560fa9c9c860bb21a9342215a1265bbb0/2d548f014cb90853a0c7ef8ec188519f.png' },
    { symbol: 'thBILL', address: '0xfDD22Ce6D1F66bc0Ec89b20BF16CcB6670F55A5a', decimals: 6, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xfdd22ce6d1f66bc0ec89b20bf16ccb6670f55a5a/d9886cb653b05059a0813753fc786a60.png' },
    { symbol: 'xSolvBTC', address: '0xc99F5c922DAE05B6e2ff83463ce705eF7C91F077', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xc99f5c922dae05b6e2ff83463ce705ef7c91f077/a8de7a7885d62a4225f2a6c95aed54c4.png' },
    { symbol: 'USR', address: '0x0aD339d66BF4AeD5ce31c64Bc37B3244b6394A77', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x0ad339d66bf4aed5ce31c64bc37b3244b6394a77/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'vkHYPE', address: '0x9BA2EDc44E0A4632EB4723E81d4142353e1bB160', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x9ba2edc44e0a4632eb4723e81d4142353e1bb160/fdfdade6f69aae63eaaa743d13103614.png' },
    { symbol: 'uniBTC', address: '0xF9775085d726E782E83585033B58606f7731AB18', decimals: 8, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xf9775085d726e782e83585033b58606f7731ab18/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'vHYPE', address: '0x8888888FdAAc0E7CF8C6523c8955bF7954c216fa', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x8888888fdaac0e7cf8c6523c8955bf7954c216fa/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'hbUSDT', address: '0x5e105266db42f78FA814322Bce7f388B4C2e61eb', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x5e105266db42f78fa814322bce7f388b4c2e61eb/4afc531c6237e1d72725e9b9d59ed3b1.png' },
    { symbol: 'hbHYPE', address: '0x96C6cBB6251Ee1c257b2162ca0f39AA5Fa44B1FB', decimals: 18, logo: 'https://www.hyperbeat.org/assets/images/vaults/hbhype.svg' },
    { symbol: 'SEDA', address: '0x4F96b683714377C38123631f2d17cDF18b3F46a7', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x4f96b683714377c38123631f2d17cdf18b3f46a7/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'USDH', address: '0x111111a1a0667d36bD57c0A9f569b98057111111', decimals: 6, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x111111a1a0667d36bd57c0a9f569b98057111111/91ee237386e06760635dc094d72781bd.png' },
    { symbol: 'lstHYPE', address: '0x81e064d0eB539de7c3170EDF38C1A42CBd752A76', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x81e064d0eb539de7c3170edf38c1a42cbd752a76/b9a27f21cf8451d7856fdcf68b1607fc.png' },
    { symbol: 'sfrxUSD', address: '0x5Bff88cA1442c2496f7E475E9e7786383Bc070c0', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x5bff88ca1442c2496f7e475e9e7786383bc070c0/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'uSOL', address: '0x068f321Fa8Fb9f0D135f290Ef6a3e2813e1c8A29', decimals: 9, logo: 'https://app.hyperliquid.xyz/coins/SOL_USDC.svg' },
    { symbol: 'liquidHYPE', address: '0x441794D6a8F9A3739F5D4E98a728937b33489D29', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x441794d6a8f9a3739f5d4e98a728937b33489d29/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'hwHLP', address: '0x9FD7466f987Fd4C45a5BBDe22ED8aba5BC8D72d1', decimals: 6, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x9fd7466f987fd4c45a5bbde22ed8aba5bc8d72d1/f498977b6f4b1e78a8aa8f8d2bd193d2.png' },
    { symbol: 'WHLP', address: '0x1359b05241cA5076c9F59605214f4F84114c0dE8', decimals: 6, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x1359b05241ca5076c9f59605214f4f84114c0de8/b63b3d2ef4c4eb036945cb47c41f6d7c.png' },
    { symbol: 'hakHYPE', address: '0x1368Ee9d1212AE5B26Ff166049220051a9EEbc42', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x1368ee9d1212ae5b26ff166049220051a9eebc42/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'hwHYPE', address: '0x4DE03cA1F02591B717495cfA19913aD56a2f5858', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x4de03ca1f02591b717495cfa19913ad56a2f5858/eac20fd2aa57c60afdc19ae28329f67e.png' },
    { symbol: 'haHYPE', address: '0xFde5B0626fC80E36885e2fA9cD5ad9d7768D725c', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xfde5b0626fc80e36885e2fa9cd5ad9d7768d725c/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'xHYPE', address: '0xAc962FA04BF91B7fd0DC0c5C32414E0Ce3C51E03', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xac962fa04bf91b7fd0dc0c5c32414e0ce3c51e03/1744b6a0fdac845dc245f1559b66aa1b.png' },
    { symbol: 'kHYPE', address: '0xA320d9f65ec992eFf38622C63627856382Db726C', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xa320d9f65ec992eff38622c63627856382db726c/1c504e44aa70664f8be6af4158b2a65c.png' },
    { symbol: 'JEFF', address: '0x52e444545fbE9E5972a7A371299522f7871aec1F', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x52e444545fbe9e5972a7a371299522f7871aec1f/7a3a398661469f0ef0a4e165faaf2b75.png' },
    { symbol: 'BRIDGE', address: '0x29dbF86A8c48EA4331e28b3c1EAE824A2A45996a', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x29dbf86a8c48ea4331e28b3c1eae824a2a45996a/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'HLP0', address: '0x3D75F2BB8aBcDBd1e27443cB5CBCE8A668046C81', decimals: 6, logo: 'https://static.debank.com/image/arb_token/logo_url/0x3d75f2bb8abcdbd1e27443cb5cbce8a668046c81/1b4547bb5ee7049827a75566036e8ea8.png' },
    { symbol: 'PEG', address: '0x28245AB01298eaEf7933bc90d35Bd9DbCA5C89DB', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x28245ab01298eaef7933bc90d35bd9dbca5c89db/7b920b29ba80e30affd21cb3886a844a.png' },
    { symbol: 'LINK0', address: '0x9A12CB8869498D8826567437abEA27Be1c2ba9Ab', decimals: 18, logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png' },
    { symbol: 'USH', address: '0x8fF0dd9f9C40a0d76eF1BcFAF5f98c1610c74Bd8', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x8ff0dd9f9c40a0d76ef1bcfaf5f98c1610c74bd8/f3c25ff66c9582940975900638accb16.png' },
    { symbol: 'sHYPE', address: '0xBef0142a0955a7d5dcce5c2a13fb84e332669d2d', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xbef0142a0955a7d5dcce5c2a13fb84e332669d2d/80f254243e1cd8584938f0b1099caaaf.png' },
    { symbol: 'stHYPE', address: '0xd4BEC48ae1D5956CA13a3e5f42E20c2b14cE3Ce5', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xd4bec48ae1d5956ca13a3e5f42e20c2b14ce3ce5/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'mHYPE', address: '0xdAbB040c428436d41CECd0Fb06bCFDBAaD3a9AA8', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xdabb040c428436d41cecd0fb06bcfdbaad3a9aa8/ed8da6028b266d2a677170223bd835d3.png' },
    { symbol: 'PEPE', address: '0xFcEB0b02c8972977FaC85C476d4354F501B9c6e4', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xfceb0b02c8972977fac85c476d4354f501b9c6e4/383d5d675e1cc433f1bf9f4fe9a17967.png' },
    { symbol: 'SWAP', address: '0x1bb86d3C4B0ecc291041f86a487d34180b1aa9aC', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x1bb86d3c4b0ecc291041f86a487d34180b1aa9ac/b9b80ac25b0c9e307b7be69d4d4e4c1d.png' },
    { symbol: 'CULT', address: '0x42a1A6D32c819cBCbFAD7483b574776e42964682', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x42a1a6d32c819cbcbfad7483b574776e42964682/15c9061b8149a4e9e727cf1ebfc0ee67.png' },
    { symbol: 'FUND', address: '0x89B0fE193887d731a2B48A5d87A1185214482AD5', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x89b0fe193887d731a2b48a5d87a1185214482ad5/4e49f9d37640a31cb323f21f5b1b85fc.png' },
    { symbol: 'HSTR', address: '0x3FA145caD2C8108A68cfc803A8e1aE246C36dF3e', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x3fa145cad2c8108a68cfc803a8e1ae246c36df3e/05d8a20c229784ed139f81195a6bbd3b.png' },
    { symbol: 'LQNA', address: '0xa94676f34f6a2764c7fde5611b53834b71f228ec', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xa94676f34f6a2764c7fde5611b53834b71f228ec/e1039a554b32e9b10520be8c38a143b8.png' },
    { symbol: 'HOBO', address: '0xaF220bf434122b431395d8782C6fc61771102e59', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xaf220bf434122b431395d8782c6fc61771102e59/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'PAWS', address: '0xe3C80b7A1A8631E8cFd59c61E2a74Eb497dB28F6', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xe3c80b7a1a8631e8cfd59c61e2a74eb497db28f6/7c313722f3e6fee0249f5de5a8b5a95f.png' },
    { symbol: 'HPDOGE', address: '0xe7F4A036b6FFa9ef7Bc6be13F47D93D9c482AA9F', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xe7f4a036b6ffa9ef7bc6be13f47d93d9c482aa9f/b9ed28317004d1a3fb73a946db167328.png' },
    { symbol: 'NAKI', address: '0x8e5E661a0Ef1663eaace624dfd6ffcccE0577E95', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x8e5e661a0ef1663eaace624dfd6ffccce0577e95/e3501bd894d4efa9bf6f17154d2f9cb9.png' },
    { symbol: 'OMNIX', address: '0x45eC8F63Fe934C0213476CFb5870835E61dd11FA', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x45ec8f63fe934c0213476cfb5870835e61dd11fa/c5f720d373e412f096ead845246e93ef.png' },
    { symbol: 'EVM', address: '0x6E0F6a71a74fAD5D0ED5A34b468203A4a4437b71', decimals: 9, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x6e0f6a71a74fad5d0ed5a34b468203a4a4437b71/cbd3f7966ded1242831baf6865d0b977.png' },
    { symbol: 'HGUN', address: '0x7f5aB8f7974FCcd857163E5DA649Eb2588201dF1', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x7f5ab8f7974fccd857163e5da649eb2588201df1/349dee7dce92fb84f3d77486780503eb.png' },
    { symbol: 'USDHL', address: '0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/66679/standard/usdhl.jpg' },
    { symbol: 'beHYPE', address: '0xd8FC8F0b03eBA61F64D08B0bef69d80916E5DdA9', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xd8fc8f0b03eba61f64d08b0bef69d80916e5dda9/a15e539995dd051b6804c6e6f9c2ddac.png' },
    { symbol: 'hbUSDC', address: '0x057ced81348D57Aad579A672d521d7b4396E8a61', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x057ced81348d57aad579a672d521d7b4396e8a61/e1ba694679c1db7c9a5bc4033127bfa0.png' },
    { symbol: 'hwUSD', address: '0xa2f8Da4a55898B6c947Fa392eF8d6BFd87A4Ff77', decimals: 6, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xa2f8da4a55898b6c947fa392ef8d6bfd87a4ff77/93c0f65762f3d8b7a9abf41eabc47c56.png' },
    { symbol: 'ezETH', address: '0x2416092f143378750bb29b79ed961ab195cceea5', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x2416092f143378750bb29b79ed961ab195cceea5/e4cac3df2fe7caa7122de22911e72a41.png' },
    { symbol: 'fHYPE', address: '0x34a70Db6c0E3d5f93d7026fa6dCd6e11adFd56C5', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x34a70db6c0e3d5f93d7026fa6dcd6e11adfd56c5/b1f4eed78e0dbdd0eb78d45adf51aafb.png' },
    { symbol: 'HYPED', address: '0x4d0fF6a0DD9f7316b674Fb37993A3Ce28BEA340e', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x4d0ff6a0dd9f7316b674fb37993a3ce28bea340e/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'IVLP', address: '0x9ac8192a68f5174e8ac8546856e0e48d346f8240', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x9ac8192a68f5174e8ac8546856e0e48d346f8240/a08743f07b3c0571ee6abba3d6c23da4.png' },
    { symbol: 'VDO', address: '0xB5EE887259F792E613edBD20dDE8970C10fefda1', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xb5ee887259f792e613edbd20dde8970c10fefda1/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'xSWAP', address: '0xF535D7406BaF7322171142BB165643821cAb01Fe', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xf535d7406baf7322171142bb165643821cab01fe/7d2450776b6a9c26b8c007ba44c02499.png' },
    { symbol: 'Re7HYPE', address: '0x182b318A8F1c7C92a7884e469442a610B0e69ed2', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x182b318a8f1c7c92a7884e469442a610b0e69ed2/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'HYPERFARM', address: '0x41928c1bf0AfD06A74aEC142819C73B2F10c2548', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0x41928c1bf0afd06a74aec142819c73b2f10c2548/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'wVLP', address: '0xD66d69c288d9a6FD735d7bE8b2e389970fC4fD42', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xd66d69c288d9a6fd735d7be8b2e389970fc4fd42/d4e6c3f3d9c0e0c5c8f1e0d5c0a5e0d5.png' },
    { symbol: 'mcUSR', address: '0xD3A9Cb7312B9c29113290758f5ADFe12304cd16A', decimals: 18, logo: 'https://static.debank.com/image/hyper_token/logo_url/0xd3a9cb7312b9c29113290758f5adfe12304cd16a/dec71581c1d5a0c9b498c5e90648f4f1.png' },
  ],
  1151111081099710: [ // Solana - All tokens from LiFi
    { symbol: 'SOL', address: '11111111111111111111111111111111', decimals: 9, logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png' },
    { symbol: 'USDT', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg' },
    { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
    { symbol: 'WSOL', address: 'So11111111111111111111111111111111111111112', decimals: 9, logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png' },
    { symbol: 'JitoSOL', address: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', decimals: 9, logo: 'https://storage.googleapis.com/token-metadata/JitoSOL-256.png' },
    { symbol: 'mSOL', address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png' },
    { symbol: 'bSOL', address: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1/logo.png' },
    { symbol: 'JTO', address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', decimals: 9, logo: 'https://metadata.jito.network/token/jto/image' },
    { symbol: 'BONK', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, logo: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
    { symbol: 'WIF', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6, logo: 'https://bafkreibk3covs5ltyqxa272uodhber6tnfl57e7yjfpqh4e3mhybz6kwjq.ipfs.nftstorage.link/' },
    { symbol: 'PYTH', address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6, logo: 'https://pyth.network/token.png' },
    { symbol: 'RAY', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png' },
    { symbol: 'ORCA', address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png' },
    { symbol: 'RENDER', address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', decimals: 8, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof/logo.png' },
    { symbol: 'JUP', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6, logo: 'https://static.jup.ag/jup/icon.png' },
    { symbol: 'W', address: '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', decimals: 6, logo: 'https://wormhole.com/token.png' },
    { symbol: 'POPCAT', address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', decimals: 9, logo: 'https://bafkreidvkvuzyslw5jh5z242lgzwzhbi2kxxnpkb74rsmfctomwqbkwu74.ipfs.nftstorage.link/' },
    { symbol: 'HNT', address: 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux', decimals: 8, logo: 'https://shdw-drive.genesysgo.net/CsDkETHRRR1EcueeN346MJoqzymkkr7RFjMqGpZMzAib/hnt.png' },
    { symbol: 'SAMO', address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU/logo.png' },
    { symbol: 'MNDE', address: 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey/logo.png' },
    { symbol: 'MOBILE', address: 'mb1eu7TzEc71KxDpsmsKoucSSuuo6KWcsfsR6hnPe2b', decimals: 6, logo: 'https://shdw-drive.genesysgo.net/CsDkETHRRR1EcueeN346MJoqzymkkr7RFjMqGpZMzAib/mobile.png' },
    { symbol: 'INF', address: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', decimals: 9, logo: 'https://infinity.so/logo.png' },
    { symbol: 'BLZE', address: 'BLZEEuZUBVqFhj8adcCFPJvPVCiCyVmh3hkJMrU8KuJA', decimals: 9, logo: 'https://solblaze.org/assets/blze.png' },
    { symbol: 'LST', address: 'LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp', decimals: 9, logo: 'https://storage.googleapis.com/static-marginfi/lst.png' },
    { symbol: 'STEP', address: 'StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT/logo.png' },
    { symbol: 'SLND', address: 'SLNDpmoWTVADgEdndyvWzroNL7zSi1dF9PC3xHGtPwp', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/SLNDpmoWTVADgEdndyvWzroNL7zSi1dF9PC3xHGtPwp/logo.png' },
    { symbol: 'SBR', address: 'Saber2gLauYim4Mvftnrasomsv6NvAuncvMEZwcLpD1', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Saber2gLauYim4Mvftnrasomsv6NvAuncvMEZwcLpD1/logo.svg' },
    { symbol: 'DUST', address: 'DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ/logo.jpg' },
    { symbol: 'TULIP', address: 'TuLipcqtGVXP9XR62wM8WWCm6a9vhLs7T1uoWBk6FDs', decimals: 6, logo: 'https://raw.githubusercontent.com/sol-farm/token-logos/main/tulip.png' },
    { symbol: 'FIDA', address: 'EchesyfXePKdLtoiZSL8pBe8Myagyy8ZRqsACNCFGnvp', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EchesyfXePKdLtoiZSL8pBe8Myagyy8ZRqsACNCFGnvp/logo.svg' },
    { symbol: 'GENE', address: 'GENEtH5amGSi8kHAtQoezp1XEXwZJ8vcuePYnXdKrMYz', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/GENEtH5amGSi8kHAtQoezp1XEXwZJ8vcuePYnXdKrMYz/logo.png' },
    { symbol: 'KMNO', address: 'KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS', decimals: 6, logo: 'https://cdn.kamino.finance/kamino-token-icon.png' },
    { symbol: 'HONEY', address: 'HonyeYAaTPgKUgQpayL914P6VAqbQZPrbkGMETZvW4iN', decimals: 6, logo: 'https://hivemapper-marketing-public.s3.us-west-2.amazonaws.com/Hivemapper_HONEY_token.png' },
    { symbol: 'PRCL', address: 'PrcLhJSHi5M27cqFYkGx1pKMY3LkxwUGJpP9LFy8toE', decimals: 6, logo: 'https://parcl.co/prcl-token.png' },
    { symbol: 'WEN', address: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk', decimals: 5, logo: 'https://shdw-drive.genesysgo.net/GwJapVHVvfM4Mw4sWszkzywncUWuxxPd6s9VuFfXLb7e/wen_logo.png' },
    { symbol: 'TBTC', address: '6DNSN2BJsaPFdFFc1zP37kkeNe4Usc1Sqkzr9C9vPWcU', decimals: 8, logo: 'https://raw.githubusercontent.com/wormhole-foundation/wormhole-token-list/main/assets/tBTC_wh.png' },
    { symbol: 'WBTC', address: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', decimals: 8, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png' },
    { symbol: 'WETH', address: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', decimals: 8, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png' },
    { symbol: 'UXD', address: '7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT/uxd-icon-black.png' },
    { symbol: 'USDH', address: 'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX/usdh.svg' },
    { symbol: 'stSOL', address: '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj/logo.png' },
    { symbol: 'scnSOL', address: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm/logo.png' },
    { symbol: 'JSOL', address: '7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn/logo.svg' },
    { symbol: 'daoSOL', address: 'GEJpt3Wjmr628FqXxTgxMce1pLntcPV4uFi8ksxMyPQh', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/GEJpt3Wjmr628FqXxTgxMce1pLntcPV4uFi8ksxMyPQh/logo.png' },
    { symbol: 'laineSOL', address: 'LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X', decimals: 9, logo: 'https://shdw-drive.genesysgo.net/4DUkKJB966oMk8zq57KkAUxqg9HpuWtZ3BKobhmYph39/laineSOL.webp' },
    { symbol: 'bonkSOL', address: 'BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs', decimals: 9, logo: 'https://arweave.net/ms-FdIyJiqzzo8gPqQwXP8mNLxSL0LxZxNj29Rcq5Yo' },
    { symbol: 'edgeSOL', address: 'edge86g9cVz87xcpKpy3J77vbp4wYd9idEV562CCntt', decimals: 9, logo: 'https://raw.githubusercontent.com/igneous-labs/lst-offchain-metadata/master/edgeSOL/edgeSOL.png' },
    { symbol: 'hubSOL', address: 'HUBsveNpjo5pWqNkH57QzxjQASdTVXcSK7bVKTSZtcSX', decimals: 9, logo: 'https://shdw-drive.genesysgo.net/AHzrxKBP6fkj6sozaZ2uzv6nniJLRFnZNZQ6rEPfZM5E/hub.png' },
    { symbol: 'compassSOL', address: 'Comp4ssDzXcLeu2MnLuGNNFC4cmLPMng8qWHPvzAMU1h', decimals: 9, logo: 'https://raw.githubusercontent.com/igneous-labs/lst-offchain-metadata/master/compassSOL/compassSOL.png' },
    { symbol: 'pwrSOL', address: 'pWrSoLAhue6jUxUkbWgmEy5rD9VJTrnFrJ2KPxN4g5X', decimals: 9, logo: 'https://raw.githubusercontent.com/igneous-labs/lst-offchain-metadata/master/pwrSOL/pwrSOL.png' },
    { symbol: 'mangoSOL', address: 'MangmsBgFqJhW4cLUR9LxfVgMboY1xAoP8UUBiWwwuY', decimals: 9, logo: 'https://mango.markets/images/tokens/mangoSOL.svg' },
    { symbol: 'hSOL', address: 'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A', decimals: 9, logo: 'https://raw.githubusercontent.com/igneous-labs/lst-offchain-metadata/master/hSOL/hSOL.png' },
    { symbol: 'SHDW', address: 'SHDWyBxihqiCj6YekG2GUr7wqKLeLAMK1gHZck9pL6y', decimals: 9, logo: 'https://shdw-drive.genesysgo.net/FDcC9gn12fFkSU2KuQYH4TUjihrirLFmE2mjVNPPPdqF/250x250.png' },
    { symbol: 'ATLAS', address: 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx', decimals: 8, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx/logo.png' },
    { symbol: 'POLIS', address: 'poLisWXnNRwC6oBu1vHiuKQzFjGL4XDSu4g9qjz9qVk', decimals: 8, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/poLisWXnNRwC6oBu1vHiuKQzFjGL4XDSu4g9qjz9qVk/logo.png' },
    { symbol: 'PORT', address: 'PoRTjZMPXb9T7dyU7tpLEZRQj7e6ssfAE62j2oQuc6y', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/PoRTjZMPXb9T7dyU7tpLEZRQj7e6ssfAE62j2oQuc6y/PORT.png' },
    { symbol: 'SRM', address: 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt/logo.png' },
    { symbol: 'AUDIO', address: '9LzCMqDgTKYz9Drzqnpgee3SGa89up3a247ypMj2xrqM', decimals: 8, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/9LzCMqDgTKYz9Drzqnpgee3SGa89up3a247ypMj2xrqM/logo.png' },
    { symbol: 'GRAPE', address: '8upjSpvjcdpuzhfR1zriwg5NXkwDruejqNE9WNbPRtyA', decimals: 6, logo: 'https://lh3.googleusercontent.com/y7Wsemw9UVBc9dtjtRfVilnS1cgpDt356PPAjne5NvMXIwWz9_b7S3LHYRTMu1PVPOZ-_M9y7cqz0Kdu3-MdeCq6Emi8pk3dN8bxYy8' },
    { symbol: 'COPE', address: '8HGyAAB1yoM1ttS7pXjHMa3dukTFGQggnFFH3hJZgzQh', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/8HGyAAB1yoM1ttS7pXjHMa3dukTFGQggnFFH3hJZgzQh/logo.png' },
    { symbol: 'PRISM', address: 'PRSMNsEPqhGVCH1TtWiJqPjJyh2cKrLostPZTNy1o5x', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/PRSMNsEPqhGVCH1TtWiJqPjJyh2cKrLostPZTNy1o5x/logo.svg' },
    { symbol: 'AURY', address: 'AURYydfxJib1ZkTir1Jn1J9ECYUtjb6rKQVmtYaixWPP', decimals: 9, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/AURYydfxJib1ZkTir1Jn1J9ECYUtjb6rKQVmtYaixWPP/logo.png' },
    { symbol: 'SOLI', address: 'Soli6VYZxVi89bsozqyGe6o3BYXWSoyMgK6byng9qo7', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Soli6VYZxVi89bsozqyGe6o3BYXWSoyMgK6byng9qo7/logo.png' },
    { symbol: 'LIKE', address: '3bRTivrVsitbmCTGtqwp7hxXPsybkjn4XLNtPsHqa3zR', decimals: 9, logo: 'https://only1.io/like-token.svg' },
    { symbol: 'MEDIA', address: 'ETAtLmCmsoiEEKfNrHKJ2kYy3MoABhU6NQvpSfij5tDs', decimals: 6, logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/ETAtLmCmsoiEEKfNrHKJ2kYy3MoABhU6NQvpSfij5tDs/logo.png' },
    { symbol: 'wSOL', address: 'So11111111111111111111111111111111111111112', decimals: 9, logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png' },
    { symbol: 'ENA', address: '72QvBVwpxqmheEPfaCwWSWqEFsUy3rhWt6JhQBMNTwD1', decimals: 18, logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/30171.png' },
    { symbol: 'USDe', address: 'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT', decimals: 9, logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/29470.png' },
    { symbol: 'sUSDe', address: 'Eh6XEPhSwoLv5wFApuLc479eaFQ5ixKKGSBoNs6A3MMR', decimals: 9, logo: 'https://ethena.fi/shared/susde.svg' },
    { symbol: 'TNSR', address: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6', decimals: 9, logo: 'https://arweave.net/bfC3_QEfVT7RVHuHFLQ8kDmm3Y1z-DgBfNMRz8v61Ew' },
    { symbol: 'BOME', address: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', decimals: 6, logo: 'https://bafkreidghqewodur7dmjkaqmzpcy4uyoaogllk7whnxhp7m5fyqb3gyfuy.ipfs.nftstorage.link/' },
    { symbol: 'SLERF', address: '7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3', decimals: 9, logo: 'https://bafkreidrlc7dsp5i7rq3zjrjgfxrlj4adxcdpz4uasvldjzawgtgw7kmee.ipfs.nftstorage.link/' },
    { symbol: 'MEW', address: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', decimals: 5, logo: 'https://bafkreidlwyr565dxtao2ipsze6bmzpszqvvqk5jwtuuwo7w34d3pc3i3ji.ipfs.nftstorage.link/' },
    { symbol: 'PUPS', address: 'PUPS8ZgJ5po4UmNDfqtDMCPP6M1KP3EjKhKjVDFUv8k', decimals: 9, logo: 'https://arweave.net/JYR5A9zc7REmEsN0IQQJK3T7gYfOv0spR8EUL88ABsM' },
    { symbol: 'PONKE', address: '5z3EqYQo9HiCEs3R84RCDMu2n4fwFmTQ2zGmFptpnNMV', decimals: 9, logo: 'https://i.imgur.com/gVqNq4z.png' },
    { symbol: 'MYRO', address: 'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4', decimals: 9, logo: 'https://bafkreibcamzxpxmz7vq4olxx7pqvbzzrvnlf2qg2cvbwafplqsf5fyxyze.ipfs.nftstorage.link/' },
    { symbol: 'MOODENG', address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', decimals: 6, logo: 'https://ipfs.io/ipfs/QmVfEoPSGRAqbXv3u7jDLmGunz3Pms3KmFU3s57P5tMfLN' },
    { symbol: 'AI16Z', address: 'HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', decimals: 9, logo: 'https://ipfs.io/ipfs/QmQfi2VoW9F7z3VZHuSoVAGkbmz8oMZgFRFAiWDsHLz9z9' },
    { symbol: 'FARTCOIN', address: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', decimals: 6, logo: 'https://ipfs.io/ipfs/QmY4MNJp1pZxDzJpxPWXLk2XhV1n8PDamYqbcb4YMHxJxm' },
    { symbol: 'GOAT', address: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', decimals: 6, logo: 'https://ipfs.io/ipfs/Qmb4J3XwBUGv2RoMVHVGtFjnEKDaQh12xbFSNtHaqLVEnu' },
    { symbol: 'GRASS', address: 'Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs', decimals: 9, logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/33715.png' },
    { symbol: 'VIRTUAL', address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', decimals: 9, logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/29420.png' },
    { symbol: 'PENGU', address: 'PGU9EL3QBa2BqaKH5AjfMVjGj6DjPaHDM8SxQx7WpNP', decimals: 6, logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/35309.png' },
  ],
};

export default function DepositWithdrawModal() {
  const { showDepositModal, setShowDepositModal } = useModal();
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [currentStep, setCurrentStep] = useState<'idle' | 'approving' | 'depositing' | 'bridging'>('idle');
  const [selectedChain, setSelectedChain] = useState<ChainOption>(SUPPORTED_CHAINS[3]); // Default to HYPE
  const [showChainDropdown, setShowChainDropdown] = useState(false);
  const [bridgeQuote, setBridgeQuote] = useState<Route | null>(null);
  const [lifiSDK] = useState(() => new LiFiSDK());
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);
  const [showLiFiWidget, setShowLiFiWidget] = useState(false);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);
  
  // Token selection states
  const [availableTokens, setAvailableTokens] = useState<Array<{ symbol: string; address: string; decimals: number; logo?: string }>>([]);
  const [selectedToken, setSelectedToken] = useState<{ symbol: string; address: string; decimals: number; logo?: string } | null>(null);
  const [showTokenDropdown, setShowTokenDropdown] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [tokenBalance, setTokenBalance] = useState<string>('');
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  
  // Refs for click outside detection
  const chainDropdownRef = useRef<HTMLDivElement>(null);
  const tokenDropdownRef = useRef<HTMLDivElement>(null);
  
  const { address, chain: currentChain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const {
    sdk,
    isConnected,
    balance,
    walletBalance,
    isLoading,
    error,
    isApproved,
    approvalAmount,
    connect,
    deposit,
    withdraw,
    approve,
    checkApproval,
    refreshBalance,
    clearError,
  } = useDepositWithdraw();

  // Helper to determine deposit mode: 'direct' (USDTO on HyperEVM), 'swap' (other HyperEVM tokens), 'bridge' (other chains)
  const getDepositMode = (): 'direct' | 'swap' | 'bridge' => {
    if (selectedChain.id !== 999) {
      return 'bridge'; // Cross-chain from other networks
    }
    // On HyperEVM
    if (selectedToken?.address.toLowerCase() === USDTO_ADDRESS.toLowerCase()) {
      return 'direct'; // Direct deposit with USDTO
    }
    return 'swap'; // Swap other HyperEVM tokens to USDTO
  };

  // Update available tokens when chain changes
  useEffect(() => {
    const tokens = CHAIN_TOKENS[selectedChain.id] || [];
    setAvailableTokens(tokens);
    
    // Auto-select first token (native token of the chain)
    if (tokens.length > 0) {
      setSelectedToken(tokens[0]);
    }
  }, [selectedChain]);

  // Sync selected chain with wallet chain automatically
  useEffect(() => {
    if (currentChain) {
      const supportedChain = SUPPORTED_CHAINS.find(c => c.id === currentChain.id);
      if (supportedChain) {
        setSelectedChain(supportedChain);
      }
    }
  }, [currentChain]);

  // Fetch token balance when token or chain changes
  useEffect(() => {
    const fetchTokenBalance = async () => {
      if (!address || !selectedToken) {
        setTokenBalance('');
        return;
      }

      setIsFetchingBalance(true);
      try {
        // Universal logic: fetch balance for selected token on selected chain
        const balance = await getChainBalance(
          selectedChain.id,
          address as string,
          selectedToken.address
        );
        setTokenBalance(balance);
      } catch (error) {
        console.error('Failed to fetch token balance:', error);
        setTokenBalance('0.00');
      } finally {
        setIsFetchingBalance(false);
      }
    };

    if (activeTab === 'deposit') {
      fetchTokenBalance();
    } else {
      setTokenBalance('');
    }
  }, [selectedToken, selectedChain, address, activeTab]);

  // Check if user has sufficient balance when amount changes
  useEffect(() => {
    if (!amount || !tokenBalance || activeTab !== 'deposit') {
      setInsufficientBalance(false);
      return;
    }
    
    const amountNum = parseFloat(amount);
    const balanceNum = parseFloat(tokenBalance);
    
    if (isNaN(amountNum) || isNaN(balanceNum)) {
      setInsufficientBalance(false);
      return;
    }
    
    setInsufficientBalance(amountNum > balanceNum);
  }, [amount, tokenBalance, activeTab]);

  // Connect SDK when modal opens and on HyperEVM, refresh balance for withdraw
  useEffect(() => {
    const initializeForWithdraw = async () => {
      if (!showDepositModal || !address) return;
      
      if (activeTab === 'withdraw') {
        console.log('Initializing for withdraw tab, currentChain:', currentChain?.id);
        
        // Switch to HyperEVM if not already
        if (currentChain?.id !== 999) {
          setIsSwitchingChain(true);
          try {
            await switchChainAsync({ chainId: 999 });
            // Wait for chain switch to propagate
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            console.error('Failed to switch to HyperEVM:', error);
          } finally {
            setIsSwitchingChain(false);
          }
        }
        
        // Connect and refresh balance
        if (!isConnected) {
          console.log('Connecting SDK...');
          await connect();
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        console.log('Refreshing balance, isConnected:', isConnected);
        await refreshBalance();
      } else if (currentChain?.id === 999 && !isConnected) {
        await connect();
      }
    };
    
    initializeForWithdraw();
  }, [showDepositModal, address, activeTab]);

  // Also refresh balance when SDK becomes connected
  useEffect(() => {
    if (isConnected && activeTab === 'withdraw' && showDepositModal) {
      console.log('SDK connected, refreshing balance...');
      refreshBalance();
    }
  }, [isConnected, activeTab, showDepositModal]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      if (chainDropdownRef.current && !chainDropdownRef.current.contains(target)) {
        setShowChainDropdown(false);
      }
      
      if (tokenDropdownRef.current && !tokenDropdownRef.current.contains(target)) {
        setShowTokenDropdown(false);
        setTokenSearch('');
      }
    };

    if (showChainDropdown || showTokenDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showChainDropdown, showTokenDropdown]);

  if (!showDepositModal) return null;

  const handleBridgeDeposit = async () => {
    if (!walletClient || !address) {
      alert('Please connect your wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    
    if (!selectedToken) {
      alert('Please select a token');
      return;
    }
    
    setShowLiFiWidget(true);
  };

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    // Check balance before proceeding
    if (insufficientBalance) {
      return; // Don't proceed, error is already shown
    }

    const mode = getDepositMode();

    // If bridge or swap needed, use LiFi widget
    if (mode === 'bridge' || mode === 'swap') {
      await handleBridgeDeposit();
      return;
    }

    // Direct deposit (USDTO on HyperEVM)
    if (!isConnected) {
      try {
        await connect();
      } catch (err) {
        console.error('Connection failed:', err);
        return;
      }
    }

    setIsProcessing(true);
    clearError();

    try {
      // Auto-approve if not already approved
      if (!isApproved) {
        setCurrentStep('approving');
        await approve();
        // Wait a moment for approval to be mined
        await new Promise(resolve => setTimeout(resolve, 2000));
        await checkApproval();
      }

      // Proceed with deposit
      setCurrentStep('depositing');
      const result = await deposit(amount);
      setSuccessMessage(`✅ Successfully deposited ${amount} USDTO!`);
      setAmount('');
      setCurrentStep('idle');
      setTimeout(() => setShowDepositModal(false), 2000);
    } catch (err: any) {
      console.error('Deposit error:', err);
      setCurrentStep('idle');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!isConnected) {
      await connect();
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    setIsProcessing(true);
    clearError();

    try {
      const result = await withdraw(amount);
      setSuccessMessage(`✅ Successfully withdrew ${amount} USDTO!`);
      setAmount('');
      setTimeout(() => setShowDepositModal(false), 2000);
    } catch (err: any) {
      console.error('Withdraw error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = () => {
    activeTab === 'deposit' ? handleDeposit() : handleWithdraw();
  };

  const setMaxAmount = () => {
    if (activeTab === 'deposit') {
      if (tokenBalance && tokenBalance !== '0') {
        setAmount(tokenBalance);
      }
    } else {
      const maxBalance = balance?.balanceFormatted || '0';
      if (maxBalance && maxBalance !== '0') {
        setAmount(maxBalance);
      }
    }
  };

  const getBalanceToShow = () =>
    activeTab === 'deposit' ? walletBalance?.balanceFormatted || '0.00' : balance?.balanceFormatted || '0.00';

  const handleTabChange = async (tab: 'deposit' | 'withdraw') => {
    setActiveTab(tab);
    setAmount('');
    setCurrentStep('idle');
    clearError();
    
    // When switching to withdraw tab, ensure we're on HyperEVM and refresh balance
    if (tab === 'withdraw') {
      // Set chain to HyperEVM for withdraw
      const hyperEVMChain = SUPPORTED_CHAINS.find(c => c.id === 999);
      if (hyperEVMChain) {
        setSelectedChain(hyperEVMChain);
        setSelectedToken(CHAIN_TOKENS[999][1]); // USDTO
      }
      
      // Switch wallet to HyperEVM if not already
      if (currentChain?.id !== 999) {
        setIsSwitchingChain(true);
        try {
          await switchChainAsync({ chainId: 999 });
          console.log('✅ Switched to HyperEVM for withdraw');
          // Wait for chain switch to fully propagate
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error('Failed to switch to HyperEVM:', error);
        } finally {
          setIsSwitchingChain(false);
        }
      }
      
      // Connect SDK and refresh balance
      if (!isConnected && address) {
        console.log('Connecting SDK for withdraw...');
        await connect();
        // Wait for connection to complete
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      console.log('Refreshing wrapper balance...');
      await refreshBalance();
    }
  };

  const getButtonText = () => {
    if (isProcessing) {
      if (currentStep === 'approving') return 'Approving...';
      if (currentStep === 'bridging') return 'Bridging...';
      if (currentStep === 'depositing') return 'Depositing...';
      return 'Processing...';
    }
    
    if (activeTab === 'deposit') {
      const mode = getDepositMode();
      if (mode === 'bridge') return 'Bridge & Deposit';
      if (mode === 'swap') return 'Swap & Deposit';
      return 'Deposit';
    }
    
    return 'Withdraw';
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-[12px] flex items-center justify-center z-[10002] animate-fade-in"
      onClick={() => setShowDepositModal(false)}
    >
      <div className="relative overflow-visible">
        {/* Close Button */}
        <button
          onClick={() => setShowDepositModal(false)}
          className="absolute -top-4 -right-4 w-8 h-8 rounded-full bg-[#000E02] hover:bg-[#2a2a2a] border border-[#162A19] flex items-center justify-center transition-all duration-200 group z-[10003]"
        >
          <svg className="w-5 h-5 text-gray-400 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div
          className="bg-[#000E02] border-2 border-[#162A19] rounded-2xl w-[322px] h-[409px] shadow-2xl shadow-green-900/20 relative flex flex-col"
          onClick={(e) => e.stopPropagation()}
          style={{ overflow: 'hidden' }}
        >

        {/* Tab Headers */}
        <div className="flex justify-center p-4 gap-2 flex-shrink-0">
          <button
            onClick={() => handleTabChange('deposit')}
            disabled={isProcessing}
            className={`rounded-[24px] w-[147px] h-[36px] transition-all duration-200  ${
              activeTab === 'deposit'
                ? 'bg-[#00570C] border border-[#00ff41]/50'
                : ''
            }`}
          >
            Deposit
          </button>
         <button
            onClick={() => handleTabChange('withdraw')}
            disabled={isProcessing}
            className={`rounded-[24px] w-[147px] h-[36px] transition-all duration-200  ${
              activeTab === 'withdraw'
                ? 'bg-[#00570C] border border-[#00ff41]/50'
                : ''
            }`}
          >
            Withdraw
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 flex flex-col gap-4 flex-1 overflow-hidden min-h-0">
          {/* Chain Selector - Only show for Deposit */}
          {activeTab === 'deposit' && (
            <div className="relative flex justify-center gap-2 align-items">
              <div>
                <label className=" text-white text-[12px] leading-6 font-400 font-['Geist',sans-serif] ">Chain:</label>
              </div>
              <div>
              <button
                onClick={() => setShowChainDropdown(!showChainDropdown)}
                className="w-[249px] h-[31px] bg-white/5 border border-white/20 rounded-[8px] py-1.5 px-3.5 flex items-center justify-between hover:border-[#00ff41]/50 transition-all duration-200"
                disabled={isProcessing || isSwitchingChain}
              >
                <div className="flex items-center gap-3">
                  {selectedChain.logoURI ? (
                    <img src={selectedChain.logoURI} alt={selectedChain.name} className="w-6 h-6 rounded-full" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00ff41] to-[#00cc33] flex items-center justify-center">
                      <span className="text-black text-xs font-bold">{selectedChain.key.substring(0, 2)}</span>
                    </div>
                  )}
                  <span className="text-white font-medium">
                    {isSwitchingChain ? 'Switching...' : selectedChain.name}
                  </span>
                </div>
                {isSwitchingChain ? (
                  <svg className="w-5 h-5 text-[#00ff41] animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>
              </div>
              
              
              {/* Chain Dropdown */}
              {showChainDropdown && (
                <div 
                  ref={chainDropdownRef}
                  className="absolute top-full left-0 right-0 mt-2 bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl shadow-2xl max-h-60 overflow-y-auto z-50"
                >
                  {SUPPORTED_CHAINS.map((chain) => (
                    <button
                      key={chain.id}
                      onClick={async () => {
                        setShowChainDropdown(false);
                        
                        // For Solana (non-EVM), just select it - user needs Phantom/Solflare wallet
                        // LiFi will handle the cross-chain bridging
                        if (chain.id === 1151111081099710) {
                          setSelectedChain(chain);
                          console.log('Solana selected - use Phantom or Solflare wallet for Solana transactions');
                          return;
                        }
                        
                        // Switch wallet chain if different (EVM chains only)
                        if (currentChain?.id !== chain.id) {
                          setIsSwitchingChain(true);
                          try {
                            await switchChainAsync({ chainId: chain.id });
                            console.log(`✅ Switched to ${chain.name}`);
                          } catch (error: any) {
                            console.error(`❌ Failed to switch to ${chain.name}:`, error);
                            // Still update selected chain for UI
                          } finally {
                            setIsSwitchingChain(false);
                          }
                        }
                        setSelectedChain(chain);
                      }}
                      disabled={isSwitchingChain}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#1a1a1a] transition-all duration-200 text-left disabled:opacity-50"
                    >
                      {chain.logoURI ? (
                        <img src={chain.logoURI} alt={chain.name} className="w-6 h-6 rounded-full" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00ff41] to-[#00cc33] flex items-center justify-center">
                          <span className="text-black text-xs font-bold">{chain.key.substring(0, 2)}</span>
                        </div>
                      )}
                      <span className="text-white">{chain.name}</span>
                      {chain.id === selectedChain.id && (
                        <svg className="w-5 h-5 text-[#00ff41] ml-auto" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chain Display - Only show for Withdraw (HyperEVM only, static) */}
          {activeTab === 'withdraw' && (
            <div className="flex justify-center gap-2 align-items">
              <div>
                <label className=" text-white text-[12px] leading-6 font-400 font-['Geist',sans-serif] ">Chain:</label>
              </div>
              <div>
                <div className="w-[249px] h-[31px] bg-white/5 border border-white/20 rounded-[8px] py-1.5 px-3.5 flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00ff41] to-[#00cc33] flex items-center justify-center overflow-hidden">
                   <img src="/image.png" alt="HyperEVM" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-white font-medium">HyperEVM</span>
                </div>
              </div>
            </div>
          )}

          {/* Amount Input Section */}
          
            <div className="flex justify-between ">
              <div className=' -ml-3'>
                  <label className="text-white text-[12px] font-400  font-['Geist',sans-serif]">{activeTab === 'deposit' ? 'Deposit' : 'Withdraw'}</label>
              </div>
            
              <div className="flex items-center  -mr-3">
                <span className="text-[#828892] text-[12px]">
                  Available:{''}
                  <span className="text-[#fff] font-400">
                    {activeTab === 'deposit' 
                      ? (isFetchingBalance ? '...' : `${parseFloat(tokenBalance || '0').toFixed(4)} ${selectedToken?.symbol || ''}`)
                      : (isLoading ? '...' : `${parseFloat(getBalanceToShow() || '0').toFixed(2)}`)
                    }
                  </span>
                </span>
                <button
                  onClick={setMaxAmount}
                  disabled={isProcessing || isFetchingBalance}
                  className="px-2 py-1  hover:text-[#fff] text-[#00ff41] text-xs rounded font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Max
                </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
                type="number"
                className="-ml-4 flex-1 h-[30px] bg-white/5 border border-white/20 rounded-[8px] py-1.5 px-3.5 text-white text-base outline-none transition-all duration-200 focus:border-[#00ff41]/50 placeholder:text-gray-600"
                placeholder="10"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0"
                step="0.01"
                disabled={isProcessing}
              />

            <div className='relative'>
             <button 
               onClick={() => setShowTokenDropdown(!showTokenDropdown)}
               disabled={isProcessing || activeTab === 'withdraw'}
               className="-mr-3 h-[31px] w-[88px] bg-transparent/5 border border-white/20 rounded-[8px] px-2 flex items-center justify-between hover:border-[#00ff41]/50 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
             >
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className=" -mr-1 w-[20px] h-[16px] rounded-full overflow-hidden flex-shrink-0">
                    {selectedToken?.logo ? (
                      <img
                        src={selectedToken.logo}
                        alt={selectedToken.symbol}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#00ff41] to-[#00cc33]" />
                    )}
                  </div>
                  <span className="text-white font-400 text-[12px] whitespace-nowrap truncate">
                    {selectedToken?.symbol || 'Select'}
                  </span>
                </div>
                {activeTab === 'deposit' && (
                  <svg className="w-[10px] h-[10px] ml-1 mr-2 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>
              
              {/* Token Dropdown */}
              {showTokenDropdown && activeTab === 'deposit' && (
                <div 
                  ref={tokenDropdownRef}
                  className="absolute top-full -right-5 mt-1 w-[200px] bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl shadow-2xl"
                  style={{ 
                    height: '350px',
                    display: 'flex', 
                    flexDirection: 'column',
                    zIndex: 10000
                  }}
                >
                  {/* Search Input */}
                  <div className="p-2 border-b border-[#2a2a2a]" style={{ flexShrink: 0 }}>
                    <div className="relative">
                      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search token..."
                        value={tokenSearch}
                        onChange={(e) => setTokenSearch(e.target.value)}
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg py-1.5 pl-8 pr-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#00ff41]/50"
                        autoFocus
                      />
                    </div>
                  </div>
                  {/* Token List - Scrollable */}
                  <div 
                    className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden"
                    style={{ 
                      scrollbarWidth: 'none',
                      msOverflowStyle: 'none',
                    }}
                  >
                    {availableTokens
                      .filter(token => 
                        token.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
                        token.address.toLowerCase().includes(tokenSearch.toLowerCase())
                      )
                      .map((token) => (
                        <button
                          key={token.address}
                          onClick={() => {
                            setSelectedToken(token);
                            setShowTokenDropdown(false);
                            setTokenSearch('');
                          }}
                          className="w-full px-3 py-2 flex items-center gap-2 hover:bg-[#1a1a1a] transition-all duration-200"
                        >
                          <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0">
                            {token.logo ? (
                              <img src={token.logo} alt={token.symbol} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-[#00ff41] to-[#00cc33]" />
                            )}
                          </div>
                          <span className="text-white text-sm truncate">{token.symbol}</span>
                          {token.address === selectedToken?.address && (
                            <svg className="w-4 h-4 text-[#00ff41] ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                      ))}
                    {availableTokens.filter(token => 
                      token.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
                      token.address.toLowerCase().includes(tokenSearch.toLowerCase())
                    ).length === 0 && (
                      <div className="px-3 py-4 text-gray-500 text-sm text-center">
                        No tokens found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
              
            </div>


          {/* Processing Steps Indicator */}
          {isProcessing && currentStep !== 'idle' && (
            <div className="bg-[#1a3d2a]/20 border border-[#1a3d2a] rounded-xl p-4">
              <div className="flex items-center gap-2 text-[#00ff41] text-[12px]">
                <div className="w-4 h-4 border-2 border-[#00ff41] border-t-transparent rounded-full animate-spin" />
                <span>
                  {currentStep === 'approving' && 'Approving token access...'}
                  {currentStep === 'bridging' && 'Bridging tokens to HyperEVM...'}
                  {currentStep === 'depositing' && ' Processing deposit...'}
                </span>
              </div>
            </div>
          )}

          {/* Insufficient Balance Error - Centered */}
          {insufficientBalance && activeTab === 'deposit' && (
            <div className="w-full flex justify-center">
              <div className="bg-red-500/20 border border-red-500/50 text-red-400 px-4 py-2 rounded-lg text-center text-sm">
                Insufficient {selectedToken?.symbol || 'token'} balance
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="w-full flex justify-center">
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 py-3 px-4 rounded-xl text-sm animate-slide-down text-center">
                {error}
              </div>
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="w-full flex justify-center">
              <div className="bg-green-500/10 border border-green-500/30 text-[#00ff41] py-3 px-4 rounded-xl text-sm animate-slide-down text-center">
                {successMessage}
              </div>
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={handleSubmit}
            disabled={isProcessing || isLoading || !amount || parseFloat(amount) <= 0 || (insufficientBalance && activeTab === 'deposit')}
            className="w-full h-[44px] bg-[#00FF24] hover:bg-[#000] hover:border hover:text-[#fff] cursor-pointer text-black font-400 text-[16px] py-1 px-3 rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-[10px] font-['Geist',sans-serif] mt-auto">

            {isProcessing ? (
              <>
                <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                {getButtonText()}
              </>
            ) : (
              getButtonText()
            )}
          </button>

          {/* Powered by LiFi */}
          <div className="text-center text-gray-500 text-sm">
            Powered By Lifi
          </div>
        </div>
      </div>
      </div>

      {/* Custom Bridge/Swap Modal */}
      {showLiFiWidget && selectedToken && (
        <CustomBridge
          isOpen={showLiFiWidget}
          onClose={() => {
            setShowLiFiWidget(false);
            setCurrentStep('idle');
          }}
          fromChainId={selectedChain.id}
          fromTokenAddress={selectedToken.address}
          fromTokenSymbol={selectedToken.symbol}
          fromTokenDecimals={selectedToken.decimals}
          fromAmount={amount}
          mode={getDepositMode() === 'swap' ? 'swap' : 'bridge'}
          onBridgeComplete={(toAmount) => {
            console.log('✅ Complete, received:', toAmount);
            setShowLiFiWidget(false);
            const mode = getDepositMode();
            setSuccessMessage(`✅ ${mode === 'swap' ? 'Swap' : 'Bridge'} & Deposit complete!`);
            setAmount('');
            setCurrentStep('idle');
            setTimeout(() => refreshBalance(), 2000);
          }}
          onError={(error) => {
            console.error('Error:', error);
            setShowLiFiWidget(false);
            setCurrentStep('idle');
          }}
        />
      )}
    </div>
  );
}