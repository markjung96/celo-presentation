import { ContractKit, newKit } from '@celo/contractkit';
import { OdisUtils } from '@celo/identity';
import { AuthSigner, OdisContextName, ServiceContext } from '@celo/identity/lib/odis/query';
// import Web3 from 'web3';

const ALFAJORES_RPC = 'https://celo-alfajores-rpc.allthatnode.com/lLybqBjNVvJCAtJGcWGkJQKWbXMyl5MC';
const ISSUER_PRIVATE_KEY_PUBLIC = '0x726e53db4f0a79dfd63f58b19874896fce3748fcb80874665e0c147369c04a37';
const DEK_PRIVATE_KEY = '0xc2bbdabb440141efed205497a41d5fb6114e0435fd541e368dc628a8e086bfee';
const ISSUER_PUBLIC_KEY_PERSONAL = process.env.ISSUER_PUBLIC_ADDRESS;
const ISSUER_PRIVATE_KEY_PERSONAL = process.env.ISSUER_PRIVATE_KEY;

// const web3 = new Web3(ALFAJORES_RPC);

enum ErrorMessages {
    CANNOT_GET_REMAINING_QUOTA = 'Cannot get remaining quota',
    CANNOT_TOP_UP_QUOTA = 'Cannot top up quota',
    CANNOT_REVOKE_ATTESTATION = 'Cannot revoke attestation',
    CANNOT_REGISTER_ATTESTATION = 'Cannot register attestation',
    CANNOT_LOOKUP_ATTTESTATION = 'Cannot lookup attestation',
}

class socialConnect {
    /**
     * @description kit
     * @param url - Celo Blockchain의 RPC URL
     * @returns ContractKit
     * - param으로 url을 입력하면 해당 url을 param으로 갖는 web3 객체를 param으로 갖는 ContractKit instance를 생성해준다.
     * - ContractKit instance가 반환되며, web3 library를 포함한다.
     * - 또한 Connection의 instance를 포함하는데, addAccount 및 defaultAccount를 입력할 수 있다.
     */
    private kit: ContractKit = newKit(ALFAJORES_RPC);
    /**
     * @description issue
     * @param privateKey - Issuer의 private key
     * @returns {Object} Web3AccountObject - Issuer의 Web3AccountObject
     * - address, privateKey, sign, signTransaction, encrypt를 반환합니다.
     */
    private issuer = this.kit.web3.eth.accounts.privateKeyToAccount(ISSUER_PRIVATE_KEY_PERSONAL);
    /**
     * @description authSigner
     * @returns authenticationMethod - ['wallet_key', 'encryption_key']
     * @returns rawKey - 'encryption_key'일 때, DEK_PRIVATE_KEY를 입력할 수 있다.
     * @returns contractKit - 'wallet_key'일 때, ContractKit instance를 입력할 수 있다.
     */
    private authSigner: AuthSigner = {
        // authenticationMethod: OdisUtils.Query.AuthenticationMethod.ENCRYPTION_KEY,
        // rawKey: DEK_PRIVATE_KEY,
        authenticationMethod: OdisUtils.Query.AuthenticationMethod.WALLET_KEY,
        contractKit: this.kit,
    };
    /**
     * @description serviceContext
     * @returns odisUrl - ODIS URL, 요청을 보낼 때 이쪽으로 POST 요청을 전송함.
     * @returns odisPubKey - ODIS Public Key, Wasm파일 에서 message를 verify하는 것에 사용(WasmBlsBlindingClient)
     */
    private serviceContext: ServiceContext = OdisUtils.Query.getServiceContext(OdisContextName.ALFAJORES);

    constructor() {
        /**
         * @description kit에 account 및 defaultAccount를 설정
         * - addAccount: connect kit에 account를 추가
         * - defaultAccount: contractKit의 config 및 web3 eth에 기본 account를 추가
         */
        this.kit.addAccount(ISSUER_PRIVATE_KEY_PERSONAL);
        this.kit.defaultAccount = ISSUER_PUBLIC_KEY_PERSONAL;
    }

    private async checkAndTopUpODISQuota() {
        console.log('\n ODIS Quota --------------------------------------------------------------------------------');
        let remainingQuota = 0;
        try {
            /**
             * @description getPnpQuotaStatus
             * issuer의 address, signer, serviceContext를 param으로 갖는다.
             * authSigner의 method에 따라 sign 방식이 rawKey 혹은 contractKit sign으로 나뉜다.
             */
            const quotaStatus = await OdisUtils.Quota.getPnpQuotaStatus(
                this.issuer.address,
                this.authSigner,
                this.serviceContext,
            );
            remainingQuota = quotaStatus.remainingQuota;
            console.log(`ODIS 잔여량은 ${quotaStatus.remainingQuota}개 입니다.`);
        } catch (error) {
            throw new Error(ErrorMessages.CANNOT_GET_REMAINING_QUOTA);
        }

        // remainingQuota가 1보다 작으면, 1cUSD를 사용하여 ODIS Quota를 충전한다.
        if (remainingQuota < 1) {
            console.log('ODIS 잔여량이 부족합니다. 충전합니다.');
            try {
                // cUSD token contract
                const stableTokenContract = await this.kit.contracts.getStableToken();
                // odisPayments contract
                const odisPaymentsContract = await this.kit.contracts.getOdisPayments();
                const ONE_CENT_CUSD_WEI = this.kit.web3.utils.toWei('0.01', 'ether');

                const currentAllowance = await stableTokenContract.allowance(
                    this.issuer.address,
                    odisPaymentsContract.address,
                );
                console.log(`ODIS payment contract에 대한 allowance는 ${currentAllowance} 입니다.`);

                let isEnoughAllowance = false;

                // Issuer의 odisPaymentContract에 대한 allowance가 0.01보다 작으면, 0.01cUSD를 approve한다.
                if (currentAllowance.lt(ONE_CENT_CUSD_WEI)) {
                    console.log(
                        `ODIS payment contract에 대한 allowance가 부족합니다. ${ONE_CENT_CUSD_WEI}만큼 approve합니다.`,
                    );
                    const approvalTxReceipt = await stableTokenContract
                        .increaseAllowance(odisPaymentsContract.address, ONE_CENT_CUSD_WEI)
                        .sendAndWaitForReceipt();
                    isEnoughAllowance = approvalTxReceipt.status;
                } else {
                    isEnoughAllowance = true;
                }

                if (isEnoughAllowance) {
                    const odisPayment = await odisPaymentsContract
                        .payInCUSD(this.issuer.address, ONE_CENT_CUSD_WEI)
                        .sendAndWaitForReceipt();
                    const { remainingQuota } = await OdisUtils.Quota.getPnpQuotaStatus(
                        this.issuer.address,
                        this.authSigner,
                        this.serviceContext,
                    );
                    console.log(`충전이 완료되었습니다. 현재 ODIS 잔여량은 ${remainingQuota}개 입니다.`);
                    return odisPayment.status;
                }
            } catch (error) {
                throw new Error(ErrorMessages.CANNOT_TOP_UP_QUOTA);
            }
        }
    }

    async registerAttestation(phoneNumber: string, address: string, force = false) {
        await this.checkAndTopUpODISQuota();

        console.log('\n Register Attestation ----------------------------------------------------------------------');
        console.log('USER의 phone number와 address 연동 절차를 진행합니다.');

        const attestationVerifiedTime = Math.floor(new Date().getTime() / 1000);
        const { obfuscatedIdentifier } = await OdisUtils.Identifier.getObfuscatedIdentifier(
            phoneNumber,
            OdisUtils.Identifier.IdentifierPrefix.PHONE_NUMBER,
            this.issuer.address,
            this.authSigner,
            this.serviceContext,
        );

        const federatedAttestationsContract = await this.kit.contracts.getFederatedAttestations();
        if (force) {
            console.log('강제 등록 옵션이 활성화 되었으므로, 기존에 등록 되어있는 주소가 있다면 삭제 후 재등록합니다');
            const lookupAccount = await federatedAttestationsContract.lookupAttestations(obfuscatedIdentifier, [
                this.issuer.address,
            ]);
            if (lookupAccount.accounts.length !== 0) {
                try {
                    await federatedAttestationsContract
                        .revokeAttestation(obfuscatedIdentifier, this.issuer.address, address)
                        .sendAndWaitForReceipt();
                    console.log('기존에 등록되어있던 주소가 확인되었고 성공적으로 삭제하였습니다.');
                } catch (error) {
                    throw new Error(ErrorMessages.CANNOT_REVOKE_ATTESTATION);
                }
            }
        }
        try {
            const registerResult = await federatedAttestationsContract
                .registerAttestationAsIssuer(obfuscatedIdentifier, address, attestationVerifiedTime)
                .sendAndWaitForReceipt();
            console.log('USER의 phone number와 address 연동 절차가 성공적으로 완료되었습니다.');
            return registerResult.status;
        } catch (error) {
            throw new Error(ErrorMessages.CANNOT_REGISTER_ATTESTATION);
        }
    }

    async lookupAddresses(phoneNumber: string) {
        console.log('\n Lookup Register Attestation --------------------------------------------------------------');
        console.log('USER의 phone number와 address 연동 결과를 조회합니다.');
        try {
            const federatedAttestationsContract = await this.kit.contracts.getFederatedAttestations();
            // 텍스트 식별자, ODIS 서명 식별자 등을 해싱하여 obfuscatedIdentifier를 얻는다.
            const { obfuscatedIdentifier } = await OdisUtils.Identifier.getObfuscatedIdentifier(
                phoneNumber,
                OdisUtils.Identifier.IdentifierPrefix.PHONE_NUMBER,
                this.issuer.address,
                this.authSigner,
                this.serviceContext,
            );
            // Identifier와 Issuer를 통해 Contract에 등록되어있는 plainText에 대한 attestation을 조회한다.
            const attestations = await federatedAttestationsContract.lookupAttestations(obfuscatedIdentifier, [
                this.issuer.address,
            ]);
            for (let i = 0; i < attestations.accounts.length; i++) {
                console.log(
                    `${phoneNumber}에 대해 등록된 address는 ${attestations.accounts[i]}이고, Issuer는 ${attestations.signers[i]}입니다.`,
                );
            }

            return attestations;
        } catch (error) {
            throw new Error(ErrorMessages.CANNOT_LOOKUP_ATTTESTATION);
        }
    }
}
export default socialConnect;

/**
 * 상황에 대한 설명
 */
(async () => {
    const social = new socialConnect();

    const USER_PHONE_NUMBER = '+821011111116';
    const USER_PUBLIC_ADDRESS1 = '0x074CBA836734296fc7E5889448bba916d50C912D';
    const USER_PUBLIC_ADDRESS2 = '0x690f64319517ab7d99F90d021c8B2CB5C9310e24';

    const register = await social.registerAttestation(USER_PHONE_NUMBER, USER_PUBLIC_ADDRESS1);

    const account = await social.lookupAddresses(USER_PHONE_NUMBER);
})();
