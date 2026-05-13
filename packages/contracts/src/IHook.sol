// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IHook
/// @notice Interface for CCTP V2 Hook contracts that execute atomically on USDC mint.
/// @dev Implement this interface to perform a swap immediately after cross-chain USDC arrives.
interface IHook {
    /// @notice Called by the CCTP V2 TokenMessengerWithMetadata contract after minting USDC.
    /// @param amount The amount of USDC minted (6 decimals).
    /// @param recipient The intended recipient address.
    /// @param hookData Arbitrary bytes encoded by the sender, e.g. swap parameters.
    function receiveWithHook(uint256 amount, address recipient, bytes calldata hookData) external;
}
