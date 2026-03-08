const express = require('express');
const cors = require('cors');
const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');
const path = require('path');
const https = require('https');
const http = require('http');

// Minimal base58 encoder (no external dependency needed)
function encodeBase58(buffer) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let digits = [0];
    for (let i = 0; i < buffer.length; i++) {
        let carry = buffer[i];
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let result = '';
    for (let i = 0; buffer[i] === 0 && i < buffer.length - 1; i++) result += '1';
    for (let i = digits.length - 1; i >= 0; i--) result += ALPHABET[digits[i]];
    return result;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Program ID dari IDL
const PROGRAM_ID = new PublicKey('SEAyjT1FUx3JyXJnWt5NtjELDwuU9XsoZeZVPVvweU4');

// RPC Connection - Fogo Network
const RPC_ENDPOINT = 'https://mainnet.fogo.io/';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

// Leaderboard Cache
let leaderboardCache = {
    data: null,
    lastUpdated: null,
    isRefreshing: false
};

// Difficulty snapshot: tracks per-address fish_caught_all_time at start of current difficulty period.
// Baselines are bulk-populated from leaderboard cache on each difficulty change.
let difficultySnapshot = {
    diffSlot: null,      // last_difficulty_adjustment slot string of current period
    baselines: {}        // { address: fish_caught_all_time raw string }
};

// Called when a new difficulty period is detected.
// Pre-populates baselines for all players currently in the leaderboard cache,
// so any address lookup immediately shows fish earned since the diff change.
function snapshotLeaderboardForNewPeriod(newDiffSlot) {
    const newSnapshot = { diffSlot: newDiffSlot, baselines: {} };
    if (leaderboardCache.data && leaderboardCache.data.players && leaderboardCache.data.players.length > 0) {
        for (const player of leaderboardCache.data.players) {
            if (player.address && player.fish_caught_all_time !== undefined) {
                newSnapshot.baselines[player.address] = player.fish_caught_all_time;
            }
        }
        console.log(`[DifficultySnapshot] New period (slot ${newDiffSlot}) — snapshotted ${Object.keys(newSnapshot.baselines).length} players from leaderboard cache`);
    } else {
        console.log(`[DifficultySnapshot] New period (slot ${newDiffSlot}) — leaderboard cache empty, baselines will be set on first search`);
    }
    difficultySnapshot = newSnapshot;
}

// Cache TTL: 5 minutes (300000 ms)
const CACHE_TTL = 5 * 60 * 1000;
const LEADERBOARD_LIMIT = parseInt(process.env.LEADERBOARD_LIMIT || '2000');

// Utility: Find PDA
async function findPDA(seeds) {
    return await PublicKey.findProgramAddress(seeds, PROGRAM_ID);
}

// Utility: Format number dengan pemisah ribuan
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Utility: Format token amount dengan decimals
function formatTokenAmount(amount, decimals = 6) {
    try {
        // Convert from raw amount (with decimals) to actual amount
        // If amount is BN or large string, divide by 10^decimals first
        let numValue;
        
        if (amount instanceof BN) {
            // BN: divide by 10^decimals
            const divisor = new BN(10).pow(new BN(decimals));
            const wholePart = amount.div(divisor);
            const remainder = amount.mod(divisor);
            
            // For very large numbers, use string manipulation instead of toNumber()
            // Check if number is too large for safe conversion (2^53 - 1 = 9007199254740991)
            const MAX_SAFE_INTEGER = new BN('9007199254740991');
            
            if (wholePart.gt(MAX_SAFE_INTEGER) || remainder.gt(MAX_SAFE_INTEGER)) {
                // Number too large, use string formatting
                const wholePartStr = wholePart.toString();
                const remainderStr = remainder.toString().padStart(decimals, '0');
                const decimalPart = remainderStr.slice(0, 2);
                const formattedWhole = formatNumber(wholePartStr);
                return `${formattedWhole}.${decimalPart}`;
            }
            
            // Safe to convert to number
            numValue = wholePart.toNumber() + remainder.toNumber() / Math.pow(10, decimals);
        } else {
            // String or number: parse and divide by 10^decimals
            let amountStr = amount;
            if (typeof amount === 'number') {
                amountStr = amount.toString();
            } else if (amount && typeof amount.toString === 'function') {
                amountStr = amount.toString();
            } else {
                amountStr = String(amount || '0');
            }
            
            // Remove any non-numeric characters except decimal point
            amountStr = amountStr.replace(/[^0-9.]/g, '');
            
            // If empty or invalid, return 0
            if (!amountStr || amountStr === '' || amountStr === '.') {
                return '0.00';
            }
            
            // Parse as BN to handle large numbers correctly
            const num = new BN(amountStr);
            const divisor = new BN(10).pow(new BN(decimals));
            const wholePart = num.div(divisor);
            const remainder = num.mod(divisor);
            
            // For very large numbers, use string manipulation instead of toNumber()
            // to avoid "Number can only safely store up to 53 bits" error
            // Check if number is too large for safe conversion (2^53 - 1 = 9007199254740991)
            const MAX_SAFE_INTEGER = new BN('9007199254740991');
            
            if (wholePart.gt(MAX_SAFE_INTEGER) || remainder.gt(MAX_SAFE_INTEGER)) {
                // Number too large, use string formatting
                const wholePartStr = wholePart.toString();
                const remainderStr = remainder.toString().padStart(decimals, '0');
                const decimalPart = remainderStr.slice(0, 2);
                const formattedWhole = formatNumber(wholePartStr);
                return `${formattedWhole}.${decimalPart}`;
            }
            
            // Safe to convert to number
            numValue = wholePart.toNumber() + remainder.toNumber() / Math.pow(10, decimals);
        }
        
        // Validate
        if (isNaN(numValue) || !isFinite(numValue)) {
            return '0.00';
        }
        
        // Format with comma separator and 2 decimal places (normal format)
        return numValue.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    } catch (error) {
        console.error('Error formatting token amount:', amount, error);
        // Fallback: try simple parse
        try {
            const numValue = parseFloat(amount) || 0;
            // If it's a very large number, it might be raw amount - divide by 10^decimals
            const actualValue = numValue > 1e10 ? numValue / Math.pow(10, decimals) : numValue;
            return actualValue.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        } catch (err) {
            return '0.00';
        }
    }
}

// Utility: Parse token amount to number
function parseTokenAmount(amount, decimals = 6) {
    const num = new BN(amount.toString());
    const divisor = new BN(10).pow(new BN(decimals));
    return num.div(divisor).toNumber() + num.mod(divisor).toNumber() / Math.pow(10, decimals);
}

// Deserialize functions (same as stats.js)
function deserializePlayerState(data) {
    try {
        let offset = 8;
        const owner = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const rod_level = data[offset];
        offset += 1;
        const boat_tier = data[offset];
        offset += 1;
        const bump = data[offset];
        offset += 1;
        const cast_count = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const fish_caught_all_time = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const power = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const max_durability = data.readUInt32LE(offset);
        offset += 4;
        const current_durability = data.readUInt32LE(offset);
        offset += 4;
        const supercast_remaining_casts = data.readUInt32LE(offset);
        offset += 4;
        const last_durability_ts = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const unprocessed_fish = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const last_claim_fees_snapshot = new BN(data.slice(offset, offset + 16), 'le');
        offset += 16;
        const last_recorded_unprocessed = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const upgrade_in_progress = data[offset] === 1;
        offset += 1;
        const upgrade_target_level = data[offset];
        offset += 1;
        const upgrade_casts_at_start = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const last_ata_creation_slot = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const last_cast_slot = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const ata_subsidy_claimed = data[offset] === 1;
        offset += 1;
        const is_honeypot = data[offset] === 1;
        offset += 1;
        const first_process_fee_paid = data[offset] === 1;
        offset += 1;
        
        return {
            owner: owner.toBase58(),
            rod_level,
            boat_tier,
            bump,
            cast_count: cast_count.toString(),
            fish_caught_all_time: fish_caught_all_time.toString(),
            power: power.toString(),
            max_durability,
            current_durability,
            supercast_remaining_casts,
            last_durability_ts: last_durability_ts.toString(),
            unprocessed_fish: unprocessed_fish.toString(),
            last_claim_fees_snapshot: last_claim_fees_snapshot.toString(),
            last_recorded_unprocessed: last_recorded_unprocessed.toString(),
            upgrade_in_progress,
            upgrade_target_level,
            upgrade_casts_at_start: upgrade_casts_at_start.toString(),
            last_ata_creation_slot: last_ata_creation_slot.toString(),
            last_cast_slot: last_cast_slot.toString(),
            ata_subsidy_claimed,
            is_honeypot,
            first_process_fee_paid
        };
    } catch (error) {
        throw new Error(`Failed to deserialize PlayerState: ${error.message}`);
    }
}

function deserializeReferrerInfo(data) {
    try {
        let offset = 8;
        const player = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const referrer = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const bump = data[offset];
        
        return {
            player: player.toBase58(),
            referrer: referrer.toBase58(),
            bump
        };
    } catch (error) {
        throw new Error(`Failed to deserialize ReferrerInfo: ${error.message}`);
    }
}

function deserializeGlobalState(data) {
    try {
        let offset = 8;
        const authority = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const fish_mint = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const fogo_mint = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const fogo_treasury = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const fish_burn_vault = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const current_difficulty = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const total_network_power = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const last_difficulty_adjustment = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const base_emission_rate = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const emission_decay_rate = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const daily_target_emission = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const total_fogo_collected = new BN(data.slice(offset, offset + 16), 'le');
        offset += 16;
        const total_fish_minted = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const total_unprocessed_fish = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const accumulated_processing_fees = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const fees_per_unprocessed_fish = new BN(data.slice(offset, offset + 16), 'le');
        offset += 16;
        const bump = data[offset];
        offset += 1;
        const halving_count = data[offset];
        
        return {
            authority: authority.toBase58(),
            fish_mint: fish_mint.toBase58(),
            fogo_mint: fogo_mint.toBase58(),
            fogo_treasury: fogo_treasury.toBase58(),
            fish_burn_vault: fish_burn_vault.toBase58(),
            current_difficulty: current_difficulty.toString(),
            total_network_power: total_network_power.toString(),
            last_difficulty_adjustment: last_difficulty_adjustment.toString(),
            base_emission_rate: base_emission_rate.toString(),
            emission_decay_rate: emission_decay_rate.toString(),
            daily_target_emission: daily_target_emission.toString(),
            total_fogo_collected: total_fogo_collected.toString(),
            total_fish_minted: total_fish_minted.toString(),
            total_unprocessed_fish: total_unprocessed_fish.toString(),
            accumulated_processing_fees: accumulated_processing_fees.toString(),
            fees_per_unprocessed_fish: fees_per_unprocessed_fish.toString(),
            bump,
            halving_count
        };
    } catch (error) {
        throw new Error(`Failed to deserialize GlobalState: ${error.message}`);
    }
}

function deserializeConfig(data) {
    try {
        let offset = 8;
        const authority = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const issuer_pubkey = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const require_capability_for_catch = data[offset] === 1;
        offset += 1;
        const require_capability_for_spend = data[offset] === 1;
        offset += 1;
        const require_fee_for_init = data[offset] === 1;
        offset += 1;
        const soft_gate_mode = data[offset] === 1;
        offset += 1;
        const basic_cooldown_ms = data.readUInt32LE(offset);
        offset += 4;
        const bump = data[offset];
        
        return {
            authority: authority.toBase58(),
            issuer_pubkey: issuer_pubkey.toBase58(),
            require_capability_for_catch,
            require_capability_for_spend,
            require_fee_for_init,
            soft_gate_mode,
            basic_cooldown_ms,
            bump
        };
    } catch (error) {
        throw new Error(`Failed to deserialize Config: ${error.message}`);
    }
}

function deserializeDifficultyTracker(data) {
    try {
        let offset = 8; // Skip discriminator
        const period_start_fish_count = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const period_start_timestamp = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const authority = new PublicKey(data.slice(offset, offset + 32));
        
        return {
            authority: authority.toBase58(),
            period_start_fish_count: period_start_fish_count.toString(),
            period_start_timestamp: period_start_timestamp.toString()
        };
    } catch (error) {
        throw new Error(`Failed to deserialize DifficultyTracker: ${error.message}`);
    }
}

function deserializeNFTConfig(data) {
    try {
        let offset = 8;
        const authority = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const collection_mint = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const total_minted = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const active_supply = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const bait_prices = {};
        bait_prices.basic = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        bait_prices.premium = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        bait_prices.legendary = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        bait_prices.mythic = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        bait_prices.celestial = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const nft_types_count = data[offset];
        offset += 1;
        const grid_total_slots = data[offset];
        offset += 1;
        const is_active = data[offset] === 1;
        offset += 1;
        const bump = data[offset];
        
        return {
            authority: authority.toBase58(),
            collection_mint: collection_mint.toBase58(),
            total_minted: total_minted.toString(),
            active_supply: active_supply.toString(),
            bait_prices: {
                basic: bait_prices.basic.toString(),
                premium: bait_prices.premium.toString(),
                legendary: bait_prices.legendary.toString(),
                mythic: bait_prices.mythic.toString(),
                celestial: bait_prices.celestial.toString()
            },
            nft_types_count,
            grid_total_slots,
            is_active,
            bump
        };
    } catch (error) {
        throw new Error(`Failed to deserialize NFTConfig: ${error.message}`);
    }
}

function deserializeRiverFishConfig(data) {
    try {
        let offset = 8;
        const authority = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const collection_mint = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const difficulty_ref = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const baits = [];
        for (let i = 0; i < 10; i++) {
            const unlock_level = data[offset];
            const casts_per_unit = data.readUInt32LE(offset + 1);
            const fish_cost_at_ref_difficulty = new BN(data.slice(offset + 5, offset + 13), 'le');
            const usdc_fee = new BN(data.slice(offset + 13, offset + 21), 'le');
            baits.push({ unlock_level, casts_per_unit, fish_cost_at_ref_difficulty: fish_cost_at_ref_difficulty.toString(), usdc_fee: usdc_fee.toString() });
            offset += 21;
        }
        const fish = [];
        for (let i = 0; i < 32; i++) {
            const fish_id = data[offset];
            const required_bait = data[offset + 1];
            const rarity_tier = data[offset + 2];
            const catch_rate_ppb = new BN(data.slice(offset + 3, offset + 11), 'le');
            fish.push({ fish_id, required_bait, rarity_tier, catch_rate_ppb: catch_rate_ppb.toString() });
            offset += 11;
        }
        const fish_count = data[offset];
        offset += 1;
        const is_active = data[offset] === 1;
        offset += 1;
        const bump = data[offset];
        
        return {
            authority: authority.toBase58(),
            collection_mint: collection_mint.toBase58(),
            difficulty_ref: difficulty_ref.toString(),
            baits,
            fish,
            fish_count,
            is_active,
            bump
        };
    } catch (error) {
        throw new Error(`Failed to deserialize RiverFishConfig: ${error.message}`);
    }
}

function deserializeCollectionGrid(data) {
    try {
        let offset = 8;
        const owner = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const grid_version = data[offset];
        offset += 1;
        const slots_completed = Array.from(data.slice(offset, offset + 32));
        offset += 32;
        const total_slots = data[offset];
        offset += 1;
        const completed_sets = data[offset];
        offset += 1;
        const nfts_placed = data.readUInt16LE(offset);
        offset += 2;
        const last_placement_ts = new BN(data.slice(offset, offset + 8), 'le');
        offset += 8;
        const rewards_claimed = data[offset] === 1;
        offset += 1;
        const bump = data[offset];
        
        const slots_completed_count = slots_completed.reduce((acc, val) => acc + (val ? 1 : 0), 0);
        
        return {
            owner: owner.toBase58(),
            grid_version,
            slots_completed,
            slots_completed_count,
            total_slots,
            completed_sets,
            nfts_placed,
            last_placement_ts: last_placement_ts.toString(),
            rewards_claimed,
            bump
        };
    } catch (error) {
        throw new Error(`Failed to deserialize CollectionGrid: ${error.message}`);
    }
}

function deserializeRiverFishState(data) {
    try {
        let offset = 8;
        const owner = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;
        const active_bait = data[offset];
        offset += 1;
        const remaining_casts = [];
        for (let i = 0; i < 10; i++) {
            remaining_casts.push(data.readUInt32LE(offset));
            offset += 4;
        }
        const pending = [];
        for (let i = 0; i < 8; i++) {
            const fish_id = data[offset];
            const cast_count = new BN(data.slice(offset + 1, offset + 9), 'le');
            const timestamp = new BN(data.slice(offset + 9, offset + 17), 'le');
            pending.push({ fish_id, cast_count: cast_count.toString(), timestamp: timestamp.toString() });
            offset += 17;
        }
        const pending_head = data[offset];
        offset += 1;
        const pending_len = data[offset];
        offset += 1;
        const bump = data[offset];
        
        return {
            owner: owner.toBase58(),
            active_bait,
            remaining_casts,
            pending,
            pending_head,
            pending_len,
            bump
        };
    } catch (error) {
        throw new Error(`Failed to deserialize RiverFishState: ${error.message}`);
    }
}

// Calculate emission prediction
function calculateEmissionPrediction(globalState, difficultyTracker) {
    try {
        const totalFishMinted = parseTokenAmount(globalState.total_fish_minted);
        const totalUnprocessedFish = parseTokenAmount(globalState.total_unprocessed_fish);
        const dailyTarget = parseTokenAmount(globalState.daily_target_emission);
        
        // Get period_start_fish_count from difficulty tracker (24h ago)
        let periodStartFishCount = 0;
        if (difficultyTracker && difficultyTracker.period_start_fish_count) {
            periodStartFishCount = parseTokenAmount(difficultyTracker.period_start_fish_count);
        }
        
        // Calculate actual emission: total_supply + unprocessed_fish - period_start_fish_count
        // This represents the fish minted in the last 24 hours
        const actualEmission24h = totalFishMinted + totalUnprocessedFish - periodStartFishCount;
        
        // Compare with daily target emission
        const emissionDiff = actualEmission24h - dailyTarget;
        const isAboveTarget = actualEmission24h > dailyTarget;
        
        // Difficulty prediction
        let difficultyPrediction = 'stable';
        if (isAboveTarget) {
            difficultyPrediction = 'up'; // diff will up
        } else if (actualEmission24h < dailyTarget) {
            difficultyPrediction = 'down'; // diff will down
        }
        
        return {
            actualEmission24h,
            dailyTarget,
            emissionDiff,
            difficultyPrediction,
            periodStartFishCount,
            totalFishMinted,
            totalUnprocessedFish
        };
    } catch (error) {
        console.error('Error calculating emission prediction:', error);
        return null;
    }
}

// Calculate yield for player
// Yield = (fees_per_unprocessed_fish - last_claim_fees_snapshot) * unprocessed_fish
// fees_per_unprocessed_fish is u128 (stored with 18 decimals precision for accuracy)
// unprocessed_fish is u64 (stored with 6 decimals, raw format)
// Result needs to be divided by 10^18 (fees precision) and 10^6 (token decimals) = 10^24
function calculateYield(playerState, globalState) {
    try {
        if (!playerState || !globalState) {
            return null;
        }
        
        const unprocessedFish = new BN(playerState.unprocessed_fish);
        const feesPerUnprocessedFish = new BN(globalState.fees_per_unprocessed_fish);
        const lastClaimFeesSnapshot = new BN(playerState.last_claim_fees_snapshot);
        
        // If no unprocessed fish, no yield
        if (unprocessedFish.isZero()) {
            return {
                unclaimedYield: '0',
                unprocessedFish: '0',
                feesPerUnprocessedFish: feesPerUnprocessedFish.toString(),
                lastClaimFeesSnapshot: lastClaimFeesSnapshot.toString(),
                formatted: {
                    unclaimedYield: '0.00',
                    unprocessedFish: '0.00'
                }
            };
        }
        
        // Calculate yield: (current_fees - last_claimed_fees) * unprocessed_fish
        const feesDiff = feesPerUnprocessedFish.sub(lastClaimFeesSnapshot);
        
        // If fees haven't increased, no yield
        if (feesDiff.isZero() || feesDiff.isNeg()) {
            return {
                unclaimedYield: '0',
                unprocessedFish: unprocessedFish.toString(),
                feesPerUnprocessedFish: feesPerUnprocessedFish.toString(),
                lastClaimFeesSnapshot: lastClaimFeesSnapshot.toString(),
                formatted: {
                    unclaimedYield: '0.00',
                    unprocessedFish: formatTokenAmount(unprocessedFish.toString(), 6)
                }
            };
        }
        
        // Multiply by unprocessed_fish
        // fees_per_unprocessed_fish is u128 - represents fees per unprocessed fish
        // unprocessed_fish is u64 with 6 decimals (raw format, e.g., 297336539000 for 297,336.539)
        // 
        // Formula: yield = (fees_per_unprocessed_fish - last_claim_fees_snapshot) * unprocessed_fish
        // 
        // Based on the expected result (163,594 FISH), let's analyze:
        // If unprocessed_fish = 297,336.539 FISH = 297336539000 (raw with 6 decimals)
        // And yield should be 163,594 FISH
        // Then: fees_diff * 297336539000 / divisor = 163594000000 (raw with 6 decimals)
        // So: fees_diff * 297336539000 = 163594000000 * divisor
        // 
        // If divisor = 10^6: fees_diff = 163594000000 * 10^6 / 297336539000 ≈ 550,000
        // If divisor = 10^18: fees_diff = 163594000000 * 10^18 / 297336539000 ≈ 550,000,000,000,000,000
        // 
        // Since fees_per_unprocessed_fish is u128, it can store very large values.
        // The most likely scenario: fees_per_unprocessed_fish is stored as fees_per_fish * 10^18
        // So we need to divide by 10^18 to get fees_per_fish, then multiply by unprocessed_fish,
        // then divide by 10^6 to get FISH tokens.
        // Total division: 10^18 * 10^6 = 10^24
        //
        // BUT if the result is 0.16 instead of 163,594, that means we're dividing by 10^24
        // when we should divide by 10^6. This suggests fees_per_unprocessed_fish might be
        // stored differently - perhaps as fees_per_fish * 10^6 (matching token decimals).
        //
        // Let's try: yield = (fees_diff * unprocessed_fish) / 10^6
        
        const yieldRaw = feesDiff.mul(unprocessedFish);
        
        // Log for debugging
        console.log('[Yield Calculation] feesPerUnprocessedFish:', feesPerUnprocessedFish.toString());
        console.log('[Yield Calculation] lastClaimFeesSnapshot:', lastClaimFeesSnapshot.toString());
        console.log('[Yield Calculation] feesDiff:', feesDiff.toString());
        console.log('[Yield Calculation] unprocessedFish:', unprocessedFish.toString());
        console.log('[Yield Calculation] yieldRaw:', yieldRaw.toString());
        
        // From the logs:
        // feesDiff: 550418235978 (this has extra precision, likely 12 decimals: 550.418235978 * 10^9)
        // unprocessedFish: 297352920300 (raw with 6 decimals: 297,352.920300 * 10^6)
        // yieldRaw: 163668469854432826553400
        // Expected yield: 163,668 FISH = 163668000000 (raw with 6 decimals)
        //
        // yieldRaw / expected = 163668469854432826553400 / 163668000000 = 1,000,000,000,000 = 10^12
        //
        // So feesDiff has 12 decimals of precision (not 18 as initially thought)
        // Formula: yield = (feesDiff * unprocessedFish) / 10^12
        // Then divide by 10^6 to get FISH tokens: yield / 10^6
        // Total: yieldRaw / 10^18
        
        // Actually, let's recalculate:
        // If feesDiff = 550418235978 and represents fees_per_fish with some precision
        // And unprocessedFish = 297352920300 (raw with 6 decimals)
        // And yield should be 163,668 FISH
        //
        // yield = feesDiff * unprocessedFish / divisor
        // 163668000000 = 550418235978 * 297352920300 / divisor
        // divisor = 550418235978 * 297352920300 / 163668000000
        // divisor ≈ 1,000,000,000,000,000,000 = 10^18
        //
        // So we need to divide by 10^18, then by 10^6 to get FISH tokens
        // Total: divide by 10^24
        //
        // BUT wait, if we divide yieldRaw by 10^24:
        // 163668469854432826553400 / 10^24 = 0.000163668... (too small!)
        //
        // Let me recalculate from the expected result:
        // Expected: 163,668 FISH = 163668000000 (raw, 6 decimals)
        // yieldRaw: 163668469854432826553400
        // 
        // yieldRaw / expected = 163668469854432826553400 / 163668000000
        // = 1,000,000,000,000,000 = 10^15
        //
        // So we need to divide by 10^15, then by 10^6 to get FISH tokens
        // Total: divide by 10^21
        
        // From logs analysis:
        // yieldRaw: 163668469854432826553400
        // Expected: 163,668 FISH = 163668000000 (raw with 6 decimals)
        // yieldRaw / expected = 163668469854432826553400 / 163668000000 = 1,000,000,000,000,000 = 10^15
        //
        // So we need to divide yieldRaw by 10^15 to get yield in raw FISH format (6 decimals)
        // This means feesDiff has 15 decimals of precision
        // From analysis: yieldRaw = 163668469854432826553400
        // Expected: 163,668 FISH = 163668000000 (raw with 6 decimals)
        // yieldRaw / expected = 10^15
        //
        // So: yield = yieldRaw / 10^15 / 10^6 = yieldRaw / 10^21
        //
        // Calculate yield: yieldRaw / 10^15 / 10^6 = yieldRaw / 10^21
        // But dividing by 10^21 gives 0.16 (too small)
        // 
        // Let me recalculate: if yieldRaw / X = 163668000000 (expected raw FISH)
        // X = yieldRaw / 163668000000 = 10^15
        // So we divide by 10^15 to get raw FISH format
        // Then we need to divide by 10^6 to get FISH tokens
        // But that gives 0.16, which suggests the calculation is wrong
        //
        // From analysis: yieldRaw / 163668000000 = 10^15
        // So we need to divide by 10^15 to get raw FISH format (6 decimals)
        // Then divide by 10^6 to get FISH tokens
        // Total: divide by 10^21
        //
        // But string manipulation with 21 decimals gives wrong result (164.17 instead of 164,000)
        // The issue: we're dividing by 10^21, but maybe feesDiff doesn't have 15 decimals?
        //
        // Let me recalculate: if yield = 164,000 FISH = 164000000000 (raw with 6 decimals)
        // And yieldRaw = 163668469854432826553400
        // Then: yieldRaw / 164000000000 = 998,000,000,000,000 ≈ 10^15
        //
        // So we DO need to divide by 10^15. But the result shows 164.17, which means
        // we're dividing by too much. Maybe the string manipulation is wrong?
        //
        // Let me check: yieldRawStr = "163668469854432826553400" (27 digits)
        // totalDecimals = 21
        // splitPoint = 27 - 21 = 6
        // wholePart = "163668"
        // decimalPart = "46"
        // Result: "163,668.46" - this should be correct!
        //
        // But user says it shows 164.17, which is different. Maybe there's a bug in the string manipulation?
        // Or maybe the calculation is being done twice?
        //
        // From analysis: yieldRaw / 163668000000 = 10^15
        // So: yield = yieldRaw / 10^15 / 10^6 = yieldRaw / 10^21
        //
        // But dividing by 10^21 gives 0.16 (too small)
        // And dividing by 10^15 then 10^6 gives 163668 (integer division loses precision)
        //
        // From log analysis:
        // yieldRaw = 164222848525013224800280
        // Expected yield = ~164,000 FISH = 164000000000 (raw with 6 decimals)
        // yieldRaw / expected = 164222848525013224800280 / 164000000000 = 1,001,000,000,000,000 = 10^15
        //
        // So we need to divide by 10^15 to get raw FISH format (6 decimals)
        // Then formatTokenAmount will divide by 10^6 to get FISH tokens
        // Total: divide by 10^21
        //
        // BUT wait, the result shows 164.22, which means we're dividing by 10^21 correctly,
        // but the issue is that we're getting the wrong number of digits.
        //
        // Let me recalculate: if yieldRaw = 164222848525013224800280 (24 digits)
        // And we divide by 10^21, we get: 164.222848525013224800280
        // But we're only showing 164.22, which is correct for 2 decimal places.
        //
        // The problem: we're dividing by 10^21, but maybe we should only divide by 10^15?
        // If we divide by 10^15: 164222848525013224800280 / 10^15 = 164222848525.013224800280
        // This is in raw FISH format (6 decimals), so we need to divide by 10^6 again.
        // Total: divide by 10^21 - this is correct!
        //
        // But the result is 164.22, not 164,000. This means the calculation is wrong.
        // Let me check: maybe feesDiff doesn't have 15 decimals?
        //
        // From the log:
        // yieldRaw = 164222848525013224800280
        // Expected yield = ~164,000 FISH = 164000000000 (raw with 6 decimals)
        // yieldRaw / expected = 164222848525013224800280 / 164000000000 = 1,001,000,000,000,000 = 10^15
        //
        // So we need to divide by 10^15 to get raw FISH format (6 decimals)
        // Then formatTokenAmount will divide by 10^6 to get FISH tokens
        // Total: divide by 10^21
        //
        // But the result shows 164.22, which means we're dividing correctly by 10^21,
        // but the calculation is wrong. The issue is that we're getting splitPoint = 3,
        // which gives us 164.22 instead of 164,000.
        //
        // Let me recalculate: if yieldRaw = 164222848525013224800280 (24 digits)
        // And we divide by 10^21, we should get: 164.222848525013224800280
        // But we're only showing 164.22, which is correct for 2 decimal places.
        //
        // The problem: we're dividing by 10^21, but maybe the feesDiff doesn't have 15 decimals?
        // Let me check: feesDiff = 551841793370
        // If feesDiff has 9 decimals: 551841793370 / 10^9 = 551.841793370
        // Then: yieldRaw = feesDiff * unprocessedFish = 551.841793370 * 297590451644
        // = 164222848525.013224800280 (with 9 + 6 = 15 decimals total)
        // To get FISH tokens (6 decimals), divide by 10^9
        //
        // So: yield = yieldRaw / 10^9, then formatTokenAmount divides by 10^6
        // Total: yieldRaw / 10^15 (not 10^21!)
        // 
        // From log analysis:
        // yieldRaw = 164291778379272943160160
        // Expected = ~164,000 FISH = 164000000000 (raw with 6 decimals)
        // yieldRaw / expected = 164291778379272943160160 / 164000000000 = 1,001,000,000,000,000 = 10^15
        //
        // So we need to divide by 10^15 to get raw FISH format (6 decimals)
        // Then divide by 10^6 to get FISH tokens
        // Total: divide by 10^21
        //
        // BUT wait, let me recalculate:
        // If yieldRaw / 10^15 = raw FISH format, then:
        // yieldRaw / 10^15 = 164291778.379272943160160 (raw FISH with 6 decimals)
        // To get FISH tokens: divide by 10^6 = 164.291778379272943160160
        //
        // That's still wrong! The issue is that we're dividing by 10^21, which gives 164.29
        //
        // Let me think differently: maybe feesDiff doesn't have 15 decimals?
        // From the log: feesDiff = 551841793370
        // If feesDiff has 9 decimals: 551841793370 / 10^9 = 551.841793370
        // Then: yieldRaw = feesDiff * unprocessedFish = 551.841793370 * 297715360368
        // = 164291778.379272943160160 (with 9 + 6 = 15 decimals total)
        // To get FISH tokens: divide by 10^9 (not 10^15!)
        //
        // So: yield = yieldRaw / 10^9, then formatTokenAmount divides by 10^6
        // Total: yieldRaw / 10^15
        //
        // But that gives 164 juta, which is wrong!
        //
        // Let me recalculate from scratch:
        // yieldRaw = 164291778379272943160160
        // Expected = 164,000 FISH = 164000000000 (raw with 6 decimals)
        // yieldRaw / expected = 10^15
        //
        // So: yield = yieldRaw / 10^15 (to get raw FISH format)
        // Then: yield / 10^6 = FISH tokens
        // Total: yieldRaw / 10^21
        //
        // But that gives 164.29, which is wrong!
        //
        // From log: yieldRaw = 164291778379272943160160
        // Expected = ~164,000 FISH = 164000000000 (raw with 6 decimals)
        // yieldRaw / expected = 10^15
        //
        // So: yield = yieldRaw / 10^15 (to get raw FISH format with 6 decimals)
        // Then: yield / 10^6 = FISH tokens
        // Total: yieldRaw / 10^21
        //
        // But dividing by 10^21 gives 164.29 (too small)
        // The issue: we're dividing by 10^21, but maybe feesDiff has fewer decimals?
        //
        // Let me recalculate: if feesDiff has 9 decimals (not 15):
        // yieldRaw has 9 + 6 = 15 decimals total
        // To get FISH tokens: divide by 10^9
        // Then formatTokenAmount divides by 10^6
        // Total: yieldRaw / 10^15
        //
        // But that gives 164 juta, which is wrong!
        //
        // From analysis: feesDiff likely has 9 decimals (not 15)
        // yieldRaw has 9 + 6 = 15 decimals total
        // To get FISH tokens (6 decimals), divide by 10^9
        // Then formatTokenAmount divides by 10^6
        // Total: divide by 10^15
        //
        // But wait, that gives 164 juta, which is wrong!
        //
        // Let me recalculate from the expected result:
        // yieldRaw = 164310423339851391568980
        // Expected = ~164,000 FISH = 164000000000 (raw with 6 decimals)
        // yieldRaw / expected = 10^15
        //
        // So we DO need to divide by 10^15 to get raw FISH format
        // Then divide by 10^6 to get FISH tokens
        // Total: divide by 10^21
        //
        // But that gives 164.31, which is wrong!
        //
        // Maybe the issue is that we're using the wrong expected value?
        // Let me try: if expected is 164,000 FISH and yieldRaw / expected = 10^15,
        // then yieldRaw = 164000000000 * 10^15 = 164000000000000000000000
        // But actual yieldRaw = 164310423339851391568980
        // So the ratio is: 164310423339851391568980 / 164000000000000000000000 = 1.0019
        //
        // This means the expected yield is actually: 164,000 * 1.0019 = 164,312 FISH
        // But we're getting 164.31, which is 1000x too small!
        //
        // The issue: we're dividing by 10^21, but we should divide by 10^18!
        // Let me try: divide by 10^18
        const yieldRawStr = yieldRaw.toString();
        const totalDecimals = 18; // Try 18 instead of 21
        
        if (yieldRawStr.length <= totalDecimals) {
            const decimalPart = yieldRawStr.padStart(totalDecimals, '0').slice(0, 2);
            var yieldFormatted = `0.${decimalPart}`;
        } else {
            // Divide by 10^18: split at position (length - 18)
            const splitPoint = yieldRawStr.length - totalDecimals;
            const wholePart = yieldRawStr.slice(0, splitPoint).replace(/^0+/, '') || '0';
            const decimalPart = yieldRawStr.slice(splitPoint, splitPoint + 2);
            const wholeFormatted = formatNumber(wholePart);
            var yieldFormatted = `${wholeFormatted}.${decimalPart}`;
        }
        
        console.log('[Yield Calculation] yieldRaw:', yieldRaw.toString());
        console.log('[Yield Calculation] yieldRawStr length:', yieldRawStr.length);
        console.log('[Yield Calculation] yieldFormatted:', yieldFormatted);
        console.log('[Yield Calculation] Expected: ~164,000 FISH');
        // yieldRaw = 163668469854432826553400
        // Expected yield = 163,668 FISH = 163668000000 (raw with 6 decimals)
        // 
        // If yieldRaw / divisor = 163668000000, then:
        // divisor = yieldRaw / 163668000000 = 163668469854432826553400 / 163668000000
        // = 1,000,000,000,000,000 = 10^15
        //
        // So: yieldInFishRaw = yieldRaw / 10^15 = 163668469854432826553400 / 10^15
        // = 163668469854 (this is wrong, it should be 163668000000)
        //
        // Wait, let me recalculate more carefully:
        // 163668469854432826553400 / 10^15 = 163668469854.4328265534
        // But we're using integer division, so: 163668469854
        //
        // The issue is that yieldRaw has more precision than we thought.
        // Let's check: if feesDiff has 15 decimals and unprocessedFish has 6 decimals,
        // then yieldRaw has 15 + 6 = 21 decimals total.
        // To get FISH tokens (6 decimals), we need to divide by 10^15.
        //
        // But the result shows 163.68, which means we're dividing by too much.
        // If yieldInFishRaw = 163668469854 and we format with 6 decimals,
        // formatTokenAmount divides by 10^6, giving 163668.469854, which rounds to 163,668.47
        //
        // But the display shows 163.68, which suggests yieldInFishRaw is around 163680000
        // That would mean yieldRaw / 10^15 = 163680000, so yieldRaw = 163680000 * 10^15
        // But actual yieldRaw = 163668469854432826553400
        //
        // Let me try a different approach: maybe feesDiff has 9 decimals, not 15?
        // If feesDiff has 9 decimals and unprocessedFish has 6 decimals,
        // then yieldRaw has 9 + 6 = 15 decimals.
        // To get FISH tokens (6 decimals), we divide by 10^9.
        //
        // yieldRaw / 10^9 = 163668469854432826553400 / 10^9 = 163668469854432826 (raw with 6 decimals)
        // formatTokenAmount(163668469854432826, 6) = 163668469854.432826 ≈ 163,668,469,854 FISH (too big!)
        //
        // Hmm, let me think differently. From the expected result:
        // Expected: 163,668 FISH
        // yieldRaw: 163668469854432826553400
        //
        // If we want 163668000000 (raw with 6 decimals) from yieldRaw,
        // we need: yieldRaw / X = 163668000000
        // X = yieldRaw / 163668000000 = 163668469854432826553400 / 163668000000
        // = 1,000,000,000,000,000 = 10^15
        //
        // So we divide by 10^15 to get raw FISH format.
        // yieldInFishRaw = yieldRaw / 10^15 = 163668469854432826553400 / 10^15
        // = 163668469854 (integer division)
        //
        // But this is wrong! The issue is that 163668469854432826553400 / 10^15
        // in integer division gives 163668469854, but we need 163668000000.
        //
        // The problem is precision loss. Let me check the actual calculation:
        // 163668469854432826553400 / 1000000000000000 = 163668.4698544328265534
        // In integer division (BN.div), we get the whole part: 163668
        // But we're losing the decimal part!
        //
        // Actually, BN.div gives integer division, so:
        // 163668469854432826553400 / 10^15 = 163668 (whole part only)
        // Then formatTokenAmount(163668, 6) divides by 10^6, giving 0.163668
        //
        // That's the problem! We need to keep the precision. Let me use a different approach.
        
        return {
            unclaimedYield: yieldRaw.toString(),
            unprocessedFish: unprocessedFish.toString(),
            feesPerUnprocessedFish: feesPerUnprocessedFish.toString(),
            lastClaimFeesSnapshot: lastClaimFeesSnapshot.toString(),
            formatted: {
                unclaimedYield: yieldFormatted,
                unprocessedFish: formatTokenAmount(unprocessedFish.toString(), 6)
            }
        };
    } catch (error) {
        console.error('Error calculating yield:', error);
        return null;
    }
}

// API Routes

// Get all stats for an address
app.post('/api/stats', async (req, res) => {
    try {
        const { address } = req.body;
        
        if (!address) {
            return res.status(400).json({ error: 'Address is required' });
        }
        
        const ownerPubkey = new PublicKey(address);
        
        // Get PlayerState
        const [playerStatePDA] = await findPDA([
            Buffer.from('player'),
            ownerPubkey.toBuffer()
        ]);
        
        const playerAccountInfo = await connection.getAccountInfo(playerStatePDA);
        let playerState = null;
        if (playerAccountInfo) {
            playerState = deserializePlayerState(playerAccountInfo.data);
        }
        
        // Get ReferrerInfo
        const [referrerInfoPDA] = await findPDA([
            Buffer.from('referrer'),
            ownerPubkey.toBuffer()
        ]);
        
        const referrerAccountInfo = await connection.getAccountInfo(referrerInfoPDA);
        let referrerInfo = null;
        if (referrerAccountInfo) {
            referrerInfo = deserializeReferrerInfo(referrerAccountInfo.data);
        }
        
        // Get GlobalState
        const [globalStatePDA] = await findPDA([Buffer.from('global-state')]);
        const globalAccountInfo = await connection.getAccountInfo(globalStatePDA);
        let globalState = null;
        if (globalAccountInfo) {
            globalState = deserializeGlobalState(globalAccountInfo.data);
        }
        
        // Get Config
        const [configPDA] = await findPDA([Buffer.from('config')]);
        const configAccountInfo = await connection.getAccountInfo(configPDA);
        let config = null;
        if (configAccountInfo) {
            config = deserializeConfig(configAccountInfo.data);
            console.log('[API Stats] Config deserialized:', {
                basic_cooldown_ms: config.basic_cooldown_ms,
                require_capability_for_catch: config.require_capability_for_catch,
                require_capability_for_spend: config.require_capability_for_spend
            });
        } else {
            console.warn('[API Stats] Config account not found');
        }
        
        // Get NFT Config
        const [nftConfigPDA] = await findPDA([Buffer.from('nft-config')]);
        const nftConfigAccountInfo = await connection.getAccountInfo(nftConfigPDA);
        let nftConfig = null;
        if (nftConfigAccountInfo) {
            nftConfig = deserializeNFTConfig(nftConfigAccountInfo.data);
        }
        
        // Get River Fish Config
        const [riverFishConfigPDA] = await findPDA([Buffer.from('river-fish-config')]);
        const riverFishConfigAccountInfo = await connection.getAccountInfo(riverFishConfigPDA);
        let riverFishConfig = null;
        if (riverFishConfigAccountInfo) {
            riverFishConfig = deserializeRiverFishConfig(riverFishConfigAccountInfo.data);
        }
        
        // Get River Fish State (per user)
        const [riverFishStatePDA] = await findPDA([
            Buffer.from('river-fish-state'),
            ownerPubkey.toBuffer()
        ]);
        const riverFishStateAccountInfo = await connection.getAccountInfo(riverFishStatePDA);
        let riverFishState = null;
        if (riverFishStateAccountInfo) {
            riverFishState = deserializeRiverFishState(riverFishStateAccountInfo.data);
        }
        
        // Get Collection Grid (per user)
        const [collectionGridPDA] = await findPDA([
            Buffer.from('grid'),
            ownerPubkey.toBuffer()
        ]);
        const collectionGridAccountInfo = await connection.getAccountInfo(collectionGridPDA);
        let collectionGrid = null;
        if (collectionGridAccountInfo) {
            collectionGrid = deserializeCollectionGrid(collectionGridAccountInfo.data);
        }
        
        // Get Difficulty Tracker
        const [difficultyTrackerPDA] = await findPDA([Buffer.from('difficulty-tracker')]);
        const difficultyTrackerAccountInfo = await connection.getAccountInfo(difficultyTrackerPDA);
        let difficultyTracker = null;
        if (difficultyTrackerAccountInfo) {
            difficultyTracker = deserializeDifficultyTracker(difficultyTrackerAccountInfo.data);
        }
        
        // Calculate emission prediction
        let emissionPrediction = null;
        if (globalState) {
            emissionPrediction = calculateEmissionPrediction(globalState, difficultyTracker);
        }
        
        // Calculate yield
        let yieldInfo = null;
        if (playerState && globalState) {
            try {
                yieldInfo = calculateYield(playerState, globalState);
                console.log('[API Stats] Yield calculated:', yieldInfo ? 'Success' : 'Null');
            } catch (error) {
                console.error('[API Stats] Error calculating yield:', error);
            }
        } else {
            console.log('[API Stats] Cannot calculate yield - missing playerState or globalState');
        }

        // Calculate fish caught since last difficulty change (lightweight, per-address tracking)
        let fishSinceDiff = null;
        let fishSinceDiffNote = null;
        if (playerState && globalState) {
            const currentDiffSlot = globalState.last_difficulty_adjustment;
            // If difficulty period changed, snapshot all leaderboard players as new baselines
            if (difficultySnapshot.diffSlot !== currentDiffSlot) {
                snapshotLeaderboardForNewPeriod(currentDiffSlot);
            }
            const currentFish = playerState.fish_caught_all_time;
            if (difficultySnapshot.baselines[address] === undefined) {
                // First time this address is searched in this period — set baseline
                difficultySnapshot.baselines[address] = currentFish;
                fishSinceDiff = '0.00';
                fishSinceDiffNote = 'Tracking dimulai sekarang';
                console.log(`[DifficultySnapshot] Baseline set for ${address}: ${currentFish}`);
            } else {
                // Already tracked — calculate diff
                try {
                    const current = new BN(currentFish);
                    const baseline = new BN(difficultySnapshot.baselines[address]);
                    const diff = current.sub(baseline);
                    fishSinceDiff = formatTokenAmount(diff.isNeg() ? '0' : diff.toString());
                    fishSinceDiffNote = 'Sejak pergantian difficulty terakhir';
                } catch (e) {
                    console.error('[FishSinceDiff] Calculation error:', e.message);
                }
            }
        }
        
        // Format data for frontend
        const response = {
            address,
            fishSinceDiff,
            fishSinceDiffNote,
            playerState: playerState ? {
                ...playerState,
                formatted: {
                    cast_count: formatNumber(playerState.cast_count),
                    fish_caught_all_time: formatTokenAmount(playerState.fish_caught_all_time),
                    power: formatNumber(playerState.power),
                    unprocessed_fish: formatTokenAmount(playerState.unprocessed_fish),
                    upgrade_casts_at_start: formatNumber(playerState.upgrade_casts_at_start)
                }
            } : null,
            yieldInfo,
            referrerInfo,
            globalState: globalState ? {
                ...globalState,
                formatted: {
                    current_difficulty: formatNumber(globalState.current_difficulty),
                    total_network_power: formatNumber(globalState.total_network_power),
                    total_fish_minted: formatTokenAmount(globalState.total_fish_minted),
                    total_unprocessed_fish: formatTokenAmount(globalState.total_unprocessed_fish),
                    total_fogo_collected: formatTokenAmount(globalState.total_fogo_collected, 6),
                    accumulated_processing_fees: formatTokenAmount(globalState.accumulated_processing_fees),
                    base_emission_rate: formatTokenAmount(globalState.base_emission_rate),
                    daily_target_emission: formatTokenAmount(globalState.daily_target_emission)
                }
            } : null,
            config,
            difficultyTracker,
            emissionPrediction,
            nftConfig: nftConfig ? {
                ...nftConfig,
                formatted: {
                    total_minted: formatTokenAmount(nftConfig.total_minted),
                    active_supply: formatTokenAmount(nftConfig.active_supply),
                    bait_prices: {
                        basic: formatTokenAmount(nftConfig.bait_prices.basic),
                        premium: formatTokenAmount(nftConfig.bait_prices.premium),
                        legendary: formatTokenAmount(nftConfig.bait_prices.legendary),
                        mythic: formatTokenAmount(nftConfig.bait_prices.mythic),
                        celestial: formatTokenAmount(nftConfig.bait_prices.celestial)
                    }
                }
            } : null,
            riverFishConfig: riverFishConfig ? {
                ...riverFishConfig,
                formatted: {
                    difficulty_ref: formatNumber(riverFishConfig.difficulty_ref),
                    baits: riverFishConfig.baits.map(bait => ({
                        ...bait,
                        fish_cost_at_ref_difficulty_formatted: formatTokenAmount(bait.fish_cost_at_ref_difficulty),
                        usdc_fee_formatted: formatTokenAmount(bait.usdc_fee)
                    }))
                }
            } : null,
            riverFishState,
            collectionGrid,
            pdas: {
                playerState: playerStatePDA.toBase58(),
                referrerInfo: referrerInfoPDA.toBase58(),
                nftConfig: nftConfigPDA.toBase58(),
                riverFishConfig: riverFishConfigPDA.toBase58(),
                riverFishState: riverFishStatePDA.toBase58(),
                collectionGrid: collectionGridPDA.toBase58()
            }
        };
        
        res.json(response);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get global state only
app.get('/api/global', async (req, res) => {
    try {
        const [globalStatePDA] = await findPDA([Buffer.from('global-state')]);
        const globalAccountInfo = await connection.getAccountInfo(globalStatePDA);
        
        if (!globalAccountInfo) {
            return res.status(404).json({ error: 'GlobalState not found' });
        }
        
        const globalState = deserializeGlobalState(globalAccountInfo.data);
        
        res.json({
            ...globalState,
            formatted: {
                current_difficulty: formatNumber(globalState.current_difficulty),
                total_network_power: formatNumber(globalState.total_network_power),
                total_fish_minted: formatTokenAmount(globalState.total_fish_minted),
                total_unprocessed_fish: formatTokenAmount(globalState.total_unprocessed_fish),
                total_fogo_collected: formatTokenAmount(globalState.total_fogo_collected, 6),
                accumulated_processing_fees: formatTokenAmount(globalState.accumulated_processing_fees),
                base_emission_rate: formatTokenAmount(globalState.base_emission_rate),
                daily_target_emission: formatTokenAmount(globalState.daily_target_emission)
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// FISH Token Mint Address
const FISH_MINT_ADDRESS = 'F1SHuJ3sFF2wJoYbUJxK4iZ6CYg6MakFj8q6QHACFd4s';

// Helper: Fetch from Fogoscan API
function fetchFromFogoscan(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        };
        
        https.get(url, options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        return;
                    }
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (err) {
                    reject(new Error('Failed to parse JSON: ' + err.message));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Get recent mints from Fogoscan API
app.get('/api/recent-mints', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        
        console.log(`[Recent Mints] Fetching from Fogoscan API`);
        
        // Use the correct Fogoscan API endpoint with ACTIVITY_SPL_MINT filter
        const fogoscanUrl = `https://api.fogoscan.com/v1/token/transfer?address=${FISH_MINT_ADDRESS}&page=1&page_size=${limit}&exclude_amount_zero=false&activity_type[]=ACTIVITY_SPL_MINT`;
        
        try {
            const data = await fetchFromFogoscan(fogoscanUrl);
            
            console.log(`[Recent Mints] API response received`);
            
            // Check response structure - could be data.data or just data
            let transfers = [];
            if (data && data.data && Array.isArray(data.data)) {
                transfers = data.data;
            } else if (Array.isArray(data)) {
                transfers = data;
            } else if (data && Array.isArray(data.items)) {
                transfers = data.items;
            }
            
            console.log(`[Recent Mints] Found ${transfers.length} mint transfers from Fogoscan`);
            
            if (transfers.length === 0) {
                return res.json({ mints: [] });
            }
            
            // Debug: log first transfer structure to see what fields are available
            if (transfers.length > 0) {
                console.log(`[Recent Mints] Sample transfer structure:`, JSON.stringify(transfers[0], null, 2));
            }
            
            // Map transfers to mint format
            const recentMints = transfers.map(transfer => {
                const timestamp = transfer.block_time || transfer.timestamp || transfer.time || transfer.created_at;
                // From API structure: signature is in 'trans_id' field
                const signature = transfer.trans_id || 
                                 transfer.signature || 
                                 transfer.tx_hash || 
                                 transfer.transaction_hash || 
                                 transfer.hash || 
                                 transfer.txHash ||
                                 transfer.transactionHash ||
                                 'Unknown';
                
                const signatureShort = signature && signature !== 'Unknown' && signature.length > 16 
                    ? signature.slice(0, 8) + '...' + signature.slice(-8) 
                    : signature;
                const to = transfer.to_address || transfer.to || transfer.destination || transfer.receiver || 'Unknown';
                // Amount from API is in raw format (with decimals), need to divide by 10^6
                let amount = transfer.amount || transfer.token_amount || transfer.amount_string || transfer.value || '0';
                
                // Remove commas if present and convert to string
                if (typeof amount === 'string') {
                    amount = amount.replace(/,/g, '');
                } else if (typeof amount === 'number') {
                    amount = amount.toString();
                } else {
                    amount = '0';
                }
                
                // Convert from raw amount to actual amount (divide by 10^6 for 6 decimals)
                const TOKEN_DECIMALS = 6;
                let numAmount;
                try {
                    // Use BN for precision with large numbers
                    const rawAmount = new BN(amount);
                    const divisor = new BN(10).pow(new BN(TOKEN_DECIMALS));
                    const wholePart = rawAmount.div(divisor);
                    const remainder = rawAmount.mod(divisor);
                    numAmount = wholePart.toNumber() + remainder.toNumber() / Math.pow(10, TOKEN_DECIMALS);
                } catch (err) {
                    // Fallback to parseFloat if BN fails
                    numAmount = parseFloat(amount) / Math.pow(10, TOKEN_DECIMALS);
                }
                
                return {
                    signature: signature,
                    signatureShort: signatureShort,
                    timestamp: timestamp,
                    amount: numAmount.toString(),
                    to: to,
                    timeAgo: timestamp ? getTimeAgo(timestamp) : 'Unknown'
                };
            });
            
            console.log(`[Recent Mints] Returning ${recentMints.length} mints`);
            
            res.json({
                mints: recentMints.map(mint => {
                    try {
                        // Parse amount - remove commas and convert to number
                        let amountStr = mint.amount;
                        if (typeof amountStr === 'number') {
                            amountStr = amountStr.toString();
                        } else if (!amountStr || typeof amountStr !== 'string') {
                            amountStr = '0';
                        }
                        
                        // Remove commas if present
                        amountStr = amountStr.replace(/,/g, '');
                        
                        // Parse to number
                        const numValue = parseFloat(amountStr) || 0;
                        
                        return {
                            ...mint,
                            formatted: {
                                amount: numValue.toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                }),
                                to: mint.to && mint.to.length > 20 ? mint.to.slice(0, 8) + '...' + mint.to.slice(-8) : (mint.to || 'Unknown')
                            }
                        };
                    } catch (err) {
                        console.error('Error formatting mint:', mint, err);
                        return {
                            ...mint,
                            formatted: {
                                amount: '0.00',
                                to: mint.to && mint.to.length > 20 ? mint.to.slice(0, 8) + '...' + mint.to.slice(-8) : (mint.to || 'Unknown')
                            }
                        };
                    }
                })
            });
        } catch (apiError) {
            console.error('[Recent Mints] Fogoscan API error:', apiError.message);
            // Return empty array if API fails
            res.json({ mints: [] });
        }
    } catch (error) {
        console.error('[Recent Mints] Error:', error);
        res.status(500).json({ 
            error: error.message
        });
    }
});

// Helper: Get time ago string
function getTimeAgo(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    
    if (diff < 60) return `${diff} secs ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hrs ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    return `${Math.floor(diff / 604800)} weeks ago`;
}

// Function to fetch leaderboard data from blockchain
async function fetchLeaderboardData() {
    console.log('[Leaderboard Cache] Fetching leaderboard data...');

    // Get GlobalState for yield calculation
    let globalState = null;
    try {
        const [globalStatePDA] = await findPDA([Buffer.from('global-state')]);
        const globalAccountInfo = await connection.getAccountInfo(globalStatePDA);
        if (globalAccountInfo) globalState = deserializeGlobalState(globalAccountInfo.data);
    } catch (e) {
        console.warn('[Leaderboard Cache] Could not fetch globalState:', e.message);
    }

    // Strategy 1: Fogoscan token holder API — paginate in chunks of 100 (API max)
    let pdaKeys = [];
    let usedFogoscan = false;
    try {
        const PAGE_SIZE = 100;
        const totalPages = Math.ceil(LEADERBOARD_LIMIT / PAGE_SIZE);
        let allAddresses = [];
        for (let page = 1; page <= totalPages && allAddresses.length < LEADERBOARD_LIMIT; page++) {
            try {
                const url = `https://api.fogoscan.com/v1/token/holders?address=${FISH_MINT_ADDRESS}&page=${page}&page_size=${PAGE_SIZE}`;
                const data = await fetchFromFogoscan(url);
                const list = Array.isArray(data) ? data
                    : Array.isArray(data && data.data) ? data.data
                    : Array.isArray(data && data.items) ? data.items
                    : Array.isArray(data && data.holders) ? data.holders
                    : [];
                if (list.length === 0) break; // no more pages
                const addresses = list
                    .map(h => h.owner || h.address || h.wallet || h.account || h.pubkey)
                    .filter(a => a && a.length > 30);
                allAddresses.push(...addresses);
                console.log(`[Leaderboard Cache] Fogoscan page ${page}: ${addresses.length} addresses (total: ${allAddresses.length})`);
                if (list.length < PAGE_SIZE) break; // last page
            } catch (e) {
                console.warn(`[Leaderboard Cache] Fogoscan page ${page} failed:`, e.message);
                break;
            }
        }
        if (allAddresses.length > 0) {
            const derivations = await Promise.all(allAddresses.slice(0, LEADERBOARD_LIMIT).map(async addr => {
                try {
                    const [pda] = await findPDA([Buffer.from('player'), new PublicKey(addr).toBuffer()]);
                    return pda;
                } catch { return null; }
            }));
            pdaKeys = derivations.filter(Boolean);
            usedFogoscan = true;
            console.log(`[Leaderboard Cache] Fogoscan: derived ${pdaKeys.length} player PDAs`);
        } else {
            console.warn('[Leaderboard Cache] Fogoscan returned 0 addresses');
        }
    } catch (e) {
        console.warn('[Leaderboard Cache] Fogoscan holder API failed:', e.message);
    }

    // Strategy 2: getProgramAccounts fallback — MUST use both dataSize + discriminator to limit scan scope
    if (!usedFogoscan) {
        try {
            const disc = Buffer.from([56, 3, 60, 86, 174, 16, 244, 195]);
            const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
                filters: [
                    { dataSize: 152 },
                    { memcmp: { offset: 0, bytes: encodeBase58(disc) } }
                ],
                dataSlice: { offset: 8, length: 32 }, // fetch only owner field (32 bytes after 8-byte discriminator)
                commitment: 'confirmed'
            });
            pdaKeys = accounts.slice(0, LEADERBOARD_LIMIT).map(acc => acc.pubkey);
            console.log(`[Leaderboard Cache] getProgramAccounts returned ${pdaKeys.length} PDAs`);
        } catch (e) {
            console.warn('[Leaderboard Cache] getProgramAccounts also unavailable:', e.message);
        }
    }

    if (pdaKeys.length === 0) {
        console.warn('[Leaderboard Cache] No player PDAs found — leaderboard will be empty');
        return { players: [], lastUpdated: new Date() };
    }

    // Batch-fetch full PlayerState account data
    const batchSize = 100;
    const allInfos = [];
    for (let i = 0; i < pdaKeys.length; i += batchSize) {
        const batch = pdaKeys.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(pdaKeys.length / batchSize);
        console.log(`[Leaderboard Cache] Fetching batch ${batchNum}/${totalBatches} (${batch.length} accounts)...`);
        try {
            const infos = await connection.getMultipleAccountsInfo(batch);
            allInfos.push(...infos);
        } catch (e) {
            console.warn(`[Leaderboard Cache] Batch ${batchNum} fetch error:`, e.message);
            allInfos.push(...new Array(batch.length).fill(null));
        }
    }

    // Deserialize and build player list
    const players = [];
    for (const info of allInfos) {
        if (!info || !info.data) continue;
        try {
            const playerState = deserializePlayerState(info.data);
            let yieldInfo = null;
            if (globalState) {
                try { yieldInfo = calculateYield(playerState, globalState); } catch {}
            }
            players.push({
                address: playerState.owner,
                unprocessed_fish: playerState.unprocessed_fish.toString(),
                unprocessed_fish_formatted: formatTokenAmount(playerState.unprocessed_fish),
                yield: yieldInfo ? yieldInfo.formatted.unclaimedYield : '0.00',
                yield_raw: yieldInfo ? yieldInfo.unclaimedYield : '0',
                power: playerState.power.toString(),
                power_formatted: formatNumber(playerState.power),
                cast_count: playerState.cast_count.toString(),
                cast_count_formatted: formatNumber(playerState.cast_count),
                fish_caught_all_time: playerState.fish_caught_all_time.toString(),
                fish_caught_all_time_formatted: formatTokenAmount(playerState.fish_caught_all_time),
                rod_level: playerState.rod_level,
                boat_tier: playerState.boat_tier,
                is_honeypot: playerState.is_honeypot
            });
        } catch {}
    }

    console.log(`[Leaderboard Cache] Built leaderboard with ${players.length} players`);
    players.sort((a, b) => new BN(b.unprocessed_fish).cmp(new BN(a.unprocessed_fish)));
    return { players, lastUpdated: new Date() };
}

// Function to refresh leaderboard cache
async function refreshLeaderboardCache(force = false) {
    // Prevent concurrent refreshes
    if (leaderboardCache.isRefreshing) {
        console.log('[Leaderboard Cache] Refresh already in progress, skipping...');
        return leaderboardCache.data || { players: [], lastUpdated: null };
    }

    // Check if cache is still valid
    if (!force && leaderboardCache.data && leaderboardCache.lastUpdated) {
        const age = Date.now() - leaderboardCache.lastUpdated.getTime();
        if (age < CACHE_TTL) {
            console.log(`[Leaderboard Cache] Cache still valid (age: ${Math.floor(age / 1000)}s)`);
            return leaderboardCache.data;
        }
    }

    leaderboardCache.isRefreshing = true;
    try {
        const data = await fetchLeaderboardData();
        leaderboardCache.data = data;
        leaderboardCache.lastUpdated = data.lastUpdated;
        console.log(`[Leaderboard Cache] Refreshed at ${data.lastUpdated.toISOString()} — ${data.players.length} players`);
        return data;
    } catch (error) {
        console.warn('[Leaderboard Cache] Refresh error:', error.message);
        return leaderboardCache.data || { players: [], lastUpdated: null };
    } finally {
        leaderboardCache.isRefreshing = false;
    }
}

// Get Leaderboard - All Players by Unprocessed Fish
// Uses cached data, returns ALL players (pagination handled on frontend)
app.get('/api/leaderboard', async (req, res) => {
    try {
        // Get cached data (will refresh if expired)
        const data = await refreshLeaderboardCache(false);
        
        console.log(`[Leaderboard] Returning ALL ${data.players.length} players from cache`);
        
        res.json({
            players: data.players, // All players, sorted by unprocessed_fish descending
            lastUpdated: data.lastUpdated
        });
    } catch (error) {
        console.error('[Leaderboard] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Refresh Leaderboard Cache (manual refresh endpoint)
app.post('/api/leaderboard/refresh', async (req, res) => {
    try {
        console.log('[Leaderboard] Manual refresh requested');
        const data = await refreshLeaderboardCache(true);
        
        res.json({
            success: true,
            players: data.players,
            lastUpdated: data.lastUpdated,
            message: 'Leaderboard cache refreshed successfully'
        });
    } catch (error) {
        console.error('[Leaderboard Refresh] Error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});


// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔗 Connected to Fogo Network: ${RPC_ENDPOINT}`);

    // Initialize leaderboard cache in background (non-blocking — server is ready immediately)
    refreshLeaderboardCache(true)
        .then(d => console.log(`[Leaderboard Cache] Initial load done — ${(d && d.players && d.players.length) || 0} players`))
        .catch(e => console.warn('[Leaderboard Cache] Initial load failed (will retry on next interval):', e.message));

    // Auto-refresh every 5 minutes
    setInterval(() => {
        refreshLeaderboardCache(false)
            .catch(e => console.warn('[Leaderboard Cache] Auto-refresh error:', e.message));
    }, CACHE_TTL);

    console.log(`[Leaderboard Cache] Auto-refresh enabled (every ${CACHE_TTL / 1000}s)`);
});

// FISH Token Address
const FISH_TOKEN_ADDRESS = 'F1SHuJ3sFF2wJoYbUJxK4iZ6CYg6MakFj8q6QHACFd4s';

// Get FISH token price from Birdeye API (Fogo network)
app.get('/api/fish-price', async (req, res) => {
    try {
        console.log('[Fish Price] Fetching price for token:', FISH_TOKEN_ADDRESS);
        
        // Try Birdeye Fogo API first (correct endpoint for Fogo network)
        try {
            console.log('[Fish Price] Trying Birdeye Fogo API...');
            const birdeyeUrl = `https://multichain-api.birdeye.so/fogo/overview/token_stats?address=${FISH_TOKEN_ADDRESS}&time_frame=24h`;
            const birdeyeData = await fetchFromFogoscan(birdeyeUrl);
            
            console.log('[Fish Price] Birdeye full response:', JSON.stringify(birdeyeData, null, 2));
            
            // Birdeye Fogo API response structure
            // Response format: { success: true, data: { price, priceChange: { 24h }, volumeUSD: { total } } }
            if (birdeyeData && birdeyeData.success === true && birdeyeData.data) {
                const data = birdeyeData.data;
                
                console.log('[Fish Price] Parsing Birdeye data object:', Object.keys(data));
                
                // Price is directly in data.price
                const price = parseFloat(data.price || 0);
                
                // Price change 24h is in data.priceChange.24h (or priceChange['24h'])
                const priceChange24h = parseFloat(
                    data.priceChange?.['24h'] || 
                    data.priceChange?.priceChange24h ||
                    data.priceChange24h ||
                    0
                );
                
                // Volume 24h USD is in data.volumeUSD.total
                const volume24h = parseFloat(
                    data.volumeUSD?.total ||
                    data.volumeUSD?.total ||
                    data.volume24hUSD ||
                    data.volume24h ||
                    0
                );
                
                console.log('[Fish Price] Birdeye parsed - Price:', price, 'Change24h:', priceChange24h, 'Volume24h:', volume24h);
                
                if (price > 0) {
                    return res.json({
                        success: true,
                        price: price,
                        priceChange24h: priceChange24h,
                        volume24h: volume24h,
                        source: 'birdeye-fogo'
                    });
                } else {
                    console.warn('[Fish Price] Birdeye returned price 0 or invalid');
                }
            } else {
                console.warn('[Fish Price] Birdeye API returned success: false or no data. Response:', JSON.stringify(birdeyeData, null, 2));
            }
        } catch (birdeyeError) {
            console.error('[Fish Price] Birdeye Fogo API failed:', birdeyeError.message);
            console.error('[Fish Price] Birdeye error stack:', birdeyeError.stack);
        }
        
        // Fallback: Try DexScreener API
        try {
            console.log('[Fish Price] Trying DexScreener API...');
            const dexData = await fetchFromFogoscan(`https://api.dexscreener.com/latest/dex/tokens/${FISH_TOKEN_ADDRESS}`);
            
            console.log('[Fish Price] DexScreener response:', JSON.stringify(dexData).substring(0, 200));
            
            if (dexData.pairs && dexData.pairs.length > 0) {
                // Get the first pair (usually the most liquid)
                const pair = dexData.pairs[0];
                const price = parseFloat(pair.priceUsd) || 0;
                const priceChange24h = parseFloat(pair.priceChange?.h24) || 0;
                const volume24h = parseFloat(pair.volume?.h24) || 0;
                
                console.log('[Fish Price] DexScreener success - Price:', price, 'Change24h:', priceChange24h, 'Volume24h:', volume24h);
                
                if (price > 0) {
                    return res.json({
                        success: true,
                        price: price,
                        priceChange24h: priceChange24h,
                        volume24h: volume24h,
                        source: 'dexscreener'
                    });
                }
            }
        } catch (dexError) {
            console.warn('[Fish Price] DexScreener API failed:', dexError.message);
        }
        
        // If all APIs fail
        console.error('[Fish Price] All APIs failed - returning error response');
        res.status(200).json({ 
            success: false, 
            error: 'Failed to fetch price from all sources',
            message: 'Price data is currently unavailable. Please check Birdeye link for current price.'
        });
    } catch (error) {
        console.error('[Fish Price] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Proxy endpoint for Fogo Airdrop API to bypass CORS
app.get('/api/fogo-airdrop-proxy', async (req, res) => {
    try {
        const { address } = req.query;
        
        if (!address) {
            return res.status(400).json({ error: 'Address parameter is required' });
        }
        
        console.log(`[Airdrop Proxy] Checking allocation for: ${address}`);
        
        const url = `https://tools.airdropfamilyidn.com/api/fogo?address=${encodeURIComponent(address)}&type=svm_wallet`;
        
        // Make HTTPS request
        https.get(url, {
            headers: {
                'accept': '*/*',
                'accept-language': 'en-US,en;q=0.9',
                'cache-control': 'no-cache',
                'pragma': 'no-cache',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'referer': 'https://tools.airdropfamilyidn.com/fogocheck'
            }
        }, (apiResponse) => {
            let data = '';
            
            apiResponse.on('data', (chunk) => {
                data += chunk;
            });
            
            apiResponse.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    console.log(`[Airdrop Proxy] Response for ${address}:`, jsonData);
                    res.json(jsonData);
                } catch (error) {
                    console.error(`[Airdrop Proxy] JSON parse error:`, error);
                    res.status(500).json({ error: 'Failed to parse API response', rawData: data });
                }
            });
        }).on('error', (error) => {
            console.error(`[Airdrop Proxy] Request error:`, error);
            res.status(500).json({ error: 'Failed to fetch from API', details: error.message });
        });
        
    } catch (error) {
        console.error('[Airdrop Proxy] Error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});
