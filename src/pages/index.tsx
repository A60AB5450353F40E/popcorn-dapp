import dynamic from 'next/dynamic'
import Head from 'next/head'
import styles from '@/styles/Home.module.css'
import { DefaultProvider, Network, TestNetWallet, UtxoI, Wallet, hexToBin } from 'mainnet-js'
import { useCallback, useEffect, useState } from 'react';
import { Contract } from '@mainnet-cash/contract';
import { CashAddressNetworkPrefix, CashAddressType, binToHex, binToNumberInt32LE, binToNumberUint16LE, cashAddressToLockingBytecode, decodeCashAddress, decodeTransaction, encodeCashAddress } from '@bitauth/libauth';
import { SignatureTemplate, Utxo } from 'cashscript';
import Image from 'next/image';
import { Artifact, scriptToBytecode, sha256 } from '@cashscript/utils';

const isActivated = true;

const WalletClass = isActivated ? Wallet : TestNetWallet;

DefaultProvider.servers.testnet = ["wss://blackie.c3-soft.com:64004"];

export const toCashScript = (utxo: UtxoI) =>
  ({
    satoshis: BigInt(utxo.satoshis),
    txid: utxo.txid,
    vout: utxo.vout,
    token: utxo.token
      ? ({
          amount: utxo.token?.amount ? BigInt(utxo.token.amount) : 0n,
          category: utxo.token?.tokenId,
          nft:
            utxo.token?.capability || utxo.token?.commitment
              ? ({
                  capability: utxo.token?.capability,
                  commitment: utxo.token?.commitment,
                })
              : undefined,
        })
      : undefined,
  } as Utxo);


export default dynamic(() => Promise.resolve(() => {
  if (!window.paytaca) {
    return (
      <div>Paytaca plugin is not installed or not supported by your browser</div>
    )
  }

  // const [tokenId, setTokenId] = useState<string | null>(localStorage.getItem("tokenId"));
  const [tokenId, setTokenId] = useState<string | null>(daoId);
  const [connectedAddress, setConnectedAddress] = useState<string | null>();
  // const [contractAddress, setContractAddress] = useState<string | null>( localStorage.getItem("contractAddress"));
  const [contractAddress, setContractAddress] = useState<string | null>(popcornStandContract.getDepositAddress());
  const [contractTokenAddress, setContractTokenAddress] = useState<string | null>(localStorage.getItem("contractTokenAddress"));
  const [walletBalance, setWalletBalance] = useState<number | null>();
  const [contractBalance, setContractBalance] = useState<number | null>();
  const [tokens, setTokens] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [mintedAmount, setMintedAmount] = useState<number>(0);
  const [mintCost, setMintCost] = useState<number>(daoPrice);

  useEffect(() => {
    (async () => {
      if (!contractAddress) {
        return
      }

      const contractWallet = await WalletClass.watchOnly(contractAddress);

      const contractUtxo = (await contractWallet.getAddressUtxos()).find(val => val.token?.tokenId === tokenId)!;
        console.log(contractUtxo);
        console.log(contractAddress);
      setContractBalance(contractUtxo.satoshis);

      contractWallet.provider.watchAddressStatus(contractAddress!, async () => {
        const contractUtxo = (await contractWallet.getAddressUtxos()).find(val => val.token?.tokenId === tokenId)!;
        console.log(contractUtxo);
        console.log(contractAddress);
        setContractBalance(contractUtxo.satoshis);
      });
    })()
  }, [tokenId, setContractBalance, contractAddress]);

  window.paytaca.on("addressChanged", (address: string) => {
    setConnectedAddress("");
  });

  useEffect(() => {
    (async () => {
      if (!connectedAddress) {
        const connected = await window.paytaca?.connected();
        if (connected) {
          let address = await window.paytaca?.address("bch");
          if (!isActivated) {
            const decoded = decodeCashAddress(address!);
            if (typeof decoded === "string") {
              setError(decoded);
              setTimeout(() => setError(""), 10000);
              return;
            }
            address = encodeCashAddress(CashAddressNetworkPrefix.testnet, CashAddressType.p2pkh, decoded.payload);
          }
          setConnectedAddress(address);
        }
        return;
      }

      const connectedWallet = await WalletClass.watchOnly(connectedAddress!);
      const utxos = await connectedWallet.getAddressUtxos();
      setWalletBalance(utxos.reduce((prev, cur) => cur.satoshis + prev, 0));

      const tokenUtxos = utxos.filter(utxo => utxo.token?.tokenId === tokenId);
      setTokens(tokenUtxos.map(val => val.token!.commitment!));

      connectedWallet.provider.watchAddressStatus(connectedAddress!, async () => {
        const utxos = await connectedWallet.getAddressUtxos();
        setWalletBalance(utxos.reduce((prev, cur) => cur.satoshis + prev, 0));

        });
    })();
  }, [connectedAddress, tokenId, setWalletBalance, setTokens]);

  const connect = useCallback(async () => {
    await window.paytaca!.connect();
    let connectedAddress = await window.paytaca!.address("bch");
    if (!connectedAddress) {
      setError("User denied connection request");
      setTimeout(() => setError(""), 10000);
      return;
    }

    if (!isActivated) {
      const decoded = decodeCashAddress(connectedAddress);
      if (typeof decoded === "string") {
        setError(decoded);
        setTimeout(() => setError(""), 10000);
        return;
      }
      connectedAddress = encodeCashAddress(CashAddressNetworkPrefix.testnet, CashAddressType.p2pkh, decoded.payload);
    }

    setConnectedAddress(connectedAddress);
  }, [setConnectedAddress]);

  const disconnect = useCallback(async () => {
    await window.paytaca!.disconnect();
    setConnectedAddress(null);
    setTokens([]);
  }, [setConnectedAddress]);

  const mint = useCallback(async () =>
  {

    const userWallet = await WalletClass.watchOnly(connectedAddress!);

    const txfee = daoPrice;

    const daoUtxos = (await popcornStandContract.getUtxos()).map(toCashScript).filter(
        val => val.token.category == daoId
    );
    console.log(daoUtxos);
    const daoInput = daoUtxos[0];

    const userUtxos = (await userWallet.getAddressUtxos()).map(toCashScript).filter(
      val => !val.token && val.satoshis >= (txfee + 800*2),
    );
    const userInput = userUtxos[0];
    if (!userInput) {
      setError("No suitable utxos found for mint. Try to consolidate your utxos!");
      setTimeout(() => setError(""), 10000);
      return;
    }
    const userSig = new SignatureTemplate(Uint8Array.from(Array(32)));

    const func = popcornStandContract.getContractFunction("MakePopcorn");
    console.log(daoInput);
    //console.log(userWallet.provider.getRawTransactionObject("a530363c3dc766676723cdfda919473c93647f0a3b899f3e38bfe3747a8881b6", true));
    console.log(userInput);
    console.log(userSig);
    const sourceTX = (await userWallet.provider.getRawTransactionObject("a530363c3dc766676723cdfda919473c93647f0a3b899f3e38bfe3747a8881b6", true));
    const sourceAmount = BigInt(sourceTX.vout[0].tokenData.amount);
    console.log(sourceTX);
    console.log(sourceAmount);
    console.log(BigInt(sourceAmount));
    console.log(daoInput.token.amount);
    console.log(daoInput.token.amount - BigInt(50));
    const transaction = func().from(daoInput).fromP2PKH(userInput, userSig).to([
      // contract pass-by
      {
        to: popcornStandContract.getTokenDepositAddress(),
        amount: BigInt(800),
        token: {
          category: daoInput.token?.category!,
          amount: sourceAmount - BigInt(50),
          nft: {
            capability: "minting",
            commitment: ""
          },
        },
      },
      // user's new NFT+FT
      {
        to: userWallet.getTokenDepositAddress(),
        amount: BigInt(800),
        token: {
          category: daoInput.token?.category!,
          amount: BigInt(50),
          nft: {
            capability: "none",
            commitment: ""
          },
        },
      }
    ]).withAge(1).withoutTokenChange().withHardcodedFee(BigInt(txfee));

    console.log((transaction as any).locktime);
    await transaction.build();
    (transaction as any).outputs[2].to = userWallet.cashaddr;

    const decoded = decodeTransaction(hexToBin(await transaction.build()));
    if (typeof decoded === "string") {
      setError(decoded);
      setTimeout(() => setError(""), 10000);
      return;
    }
    decoded.inputs[1].unlockingBytecode = Uint8Array.from([]);

    const bytecode = (transaction as any).redeemScript;
    const artifact = {...popcornStandContract.artifact} as Partial<Artifact>;
    delete artifact.source;
    delete artifact.bytecode;

    const signResult = await window.paytaca!.signTransaction({
      transaction: decoded,
      sourceOutputs: [{
        ...decoded.inputs[0],
        lockingBytecode: (cashAddressToLockingBytecode(contractAddress!) as any).bytecode,
        valueSatoshis: BigInt(daoInput.satoshis),
        token: daoInput.token && {
          ...daoInput.token,
          category: hexToBin(daoInput.token.category),
          nft: daoInput.token.nft && {
            ...daoInput.token.nft,
            commitment: hexToBin(daoInput.token.nft.commitment),
          },
        },
        contract: {
          abiFunction: (transaction as any).abiFunction,
          redeemScript: scriptToBytecode(bytecode),
          artifact: artifact,
        }
      }, {
        ...decoded.inputs[1],
        lockingBytecode: (cashAddressToLockingBytecode(connectedAddress!) as any).bytecode,
        valueSatoshis: BigInt(userInput.satoshis),
      }],
      broadcast: false,
      userPrompt: "Mint new NFT"
    });

    if (signResult === undefined) {
      setError("User rejected the transaction signing request");
      setTimeout(() => setError(""), 10000);
      return;
    }

    console.log(signResult.signedTransaction);

    try {
      await userWallet.submitTransaction(hexToBin(signResult.signedTransaction), true);
    } catch (e) {
      if ((e as any).message.indexOf('txn-mempool-conflict (code 18)') !== -1) {
        setError("Someone was faster than you at minting this NFT, please try again with the next one");
        setTimeout(() => setError(""), 10000);
        return;
      } else {
        console.trace(e);
        setError((e as any).message);
        setTimeout(() => setError(""), 10000);
        return;
      }
    }

    {
      const utxos = await userWallet.getAddressUtxos();
      setWalletBalance(utxos.reduce((prev, cur) => cur.satoshis + prev, 0));

      const tokenUtxos = utxos.filter(utxo => utxo.token?.tokenId === tokenId);
      setTokens(tokenUtxos.map());
    }
  }, [tokenId, contractAddress, connectedAddress, setWalletBalance, setTokens]);

  const consolidate = useCallback(async () => {
    const userWallet = await WalletClass.watchOnly(connectedAddress!);
    const response = await userWallet.sendMax(connectedAddress!, { buildUnsigned: true });

    const decoded = decodeTransaction(hexToBin(response.unsignedTransaction!));
    if (typeof decoded === "string") {
      setError(decoded);
      setTimeout(() => setError(""), 10000);
      return;
    }

    const signResult = await window.paytaca!.signTransaction({
      transaction: decoded,
      sourceOutputs: response.sourceOutputs!,
      broadcast: false,
      userPrompt: "Sign to consolidate"
    });

    if (signResult === undefined) {
      setError("User rejected the transaction signing request");
      setTimeout(() => setError(""), 10000);
      return;
    }

    try {
      await userWallet.submitTransaction(hexToBin(signResult.signedTransaction), true);
    } catch (e) {
      console.trace(e);
      setError((e as any).message);
      setTimeout(() => setError(""), 10000);
      return;
    }

    {
      const utxos = await userWallet.getAddressUtxos();
      setWalletBalance(utxos.reduce((prev, cur) => cur.satoshis + prev, 0));
    }
  }, [connectedAddress]);

  const signMessage = useCallback(async (message: string) => {
    const signedMessage = await window.paytaca!.signMessage({message, userPrompt: "Sign this test message"});
    if (signedMessage === undefined) {
      setError("User rejected the message signing request");
      setTimeout(() => setError(""), 10000);
      return;
    } else {
      console.log(signedMessage)
    }
  }, []);

  return (
    <>
      <Head>
        <title>Popcorn!</title>
        <meta name="description" content="" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main + "mt-10 lg:mt-0 p-[1rem] lg:px-[30%]"}>
        <h1 className="flex justify-center mb-3 text-xl font-bold">Popcorn! A Decentralized Autonomous Popcorn Stand (DAPS)</h1>
        <h2 className="flex justify-center mb-3 text-md font-bold">Donate 2000 sats to miners and receive a box of 50 popcorn.</h2>

        {error.length > 0 && <div className="flex text-lg justify-center text-red-500">{error}</div>}


        <hr className='my-5'/>

        {!connectedAddress &&
          <div className='flex flex-row gap-5 items-center'>
            <div>Please connect with Paytaca</div>
            <div>
              <button type="button" onClick={() => connect()} className="inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out">Connect</button>
            </div>
          </div>
        }

        {connectedAddress && <>
          Connected wallet: <div>{ connectedAddress }</div>
          Balance: <div>{ (walletBalance ?? 0) / 1e8 } BCH { walletBalance === 0 && <span>Get some tBCH on <a rel="noreferrer" className="text-sky-700" href='http://tbch.googol.cash' target='_blank'>http://tbch.googol.cash</a>, select chipnet</span>} </div>
          <div className='flex flex-row flex-wrap gap-5'>
            {contractAddress && <div>
              <button type="button" onClick={() => mint()} className={`inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out`}>Mint new box</button>
            </div>}
            <div>
              <button type="button" onClick={() => disconnect()} className="inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out">Disconnect paytaca</button>
            </div>
          </div>
        </>}

        {false && connectedAddress &&
        <>
          <hr className='my-5'/>
          <div>
            <div>Admin tools</div>
            <div>
              <button type="button" onClick={() => signMessage("test")} className="mt-5 inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out">Sign test message</button>
            </div>
          </div>
        </>}

        <>
          <hr className='my-5'/>
          <div>
            <div>Tools</div>
            <div>
              <button type="button" onClick={() => consolidate()}className={`inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out`}>Consolidate UTXOs</button>
            </div>
          </div>
        </>
      </main>
    </>
  )
}), { ssr: false });

const numberToBinUintLE = (value) => {
  const baseUint8Array = 256;
  const result: any[] = [];
  let remaining = value;
  while (remaining >= baseUint8Array) {
    result.push(remaining % baseUint8Array);
    remaining = Math.floor(remaining / baseUint8Array);
  }
  if (remaining > 0) result.push(remaining);
  return Uint8Array.from(result);
};
const binToFixedLength = (bin, bytes) => {
  const fixedBytes = new Uint8Array(bytes);
  const maxValue = 255;
  bin.length > bytes ? fixedBytes.fill(maxValue) : fixedBytes.set(bin);
  return fixedBytes;
};
const swapEndianness = (validHex) => binToHex(hexToBin(validHex).reverse());


const popcornStandCash = `
pragma cashscript ^0.8.0;

// Decentralized Autonomous Popcorn Stand (DAPS) v1.1.0

// Transaction Forms
//      MakePopcorn
//          Inputs: 00-covenant, 01-funding
//          Outputs: 00-covenant, 01-popcorn, 02-change

contract PopcornStand(
    int boxPrice,
    int boxQty
) {
    // Mint an NFT (popcorn box) + some FTs (popcorns)
    function MakePopcorn() {
        // TX form
        require(tx.inputs.length == 2);
        require(tx.outputs.length == 3);
        require(this.activeInputIndex == 0);

        // max 1 box / block
        require(tx.age >= 1);

        // donation to miners is the payment
        require(tx.inputs[0].value + tx.inputs[1].value
            - tx.outputs[0].value - tx.outputs[1].value - tx.outputs[2].value
            >= boxPrice);

        // release some popcorn & pass on the covenant;
        // keep track of number of boxes minted
        require(tx.outputs[0].lockingBytecode == tx.inputs[0].lockingBytecode);
        require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory);
        require(tx.outputs[0].nftCommitment == 0x);
        require(tx.outputs[0].tokenAmount + boxQty
            == tx.inputs[0].tokenAmount);

        // create a box for the popcorn
        // user is free to fill it with released popcorn (FTs)
        require(tx.outputs[1].tokenCategory == tx.inputs[0].tokenCategory.split(32)[0]);
        require(tx.outputs[1].nftCommitment == 0x);

        // verify pure BCH change
        require(tx.outputs[2].tokenCategory == 0x);
    }
}
    `.trim();

// DAO Instance
let daoId = "02a690fadd8e3ff5539726c6eca6c2b8039bce945634d78ac46b1db26a8a0eaf";

// DAO Configuration
let daoPrice = 2000;
let daoQty = 50;

const popcornStandContract = new Contract(
  popcornStandCash,
  [daoPrice,
   daoQty
  ],
  Network.MAINNET
);

console.log(popcornStandContract);
