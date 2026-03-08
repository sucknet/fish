const API_BASE = '';

// Format number with commas
function formatNumber(num) {
    if (!num) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Format token amount
function formatTokenAmount(amount, decimals = 6) {
    if (!amount && amount !== 0) return '0.00';
    const num = parseFloat(amount);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Format large numbers
function formatLargeNumber(num) {
    if (!num && num !== 0) return '0';
    const n = parseFloat(num);
    if (isNaN(n)) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return formatNumber(n);
}

function setCollapsed(toggleEl, contentEl, collapsed) {
    if (!toggleEl || !contentEl) return;
    contentEl.style.display = collapsed ? 'none' : 'block';
    toggleEl.textContent = collapsed ? 'Show' : 'Hide';
    toggleEl.setAttribute('aria-expanded', (!collapsed).toString());
    toggleEl.dataset.collapsed = collapsed ? 'true' : 'false';
}

function initCollapsible(sectionId, toggleId, contentId, defaultCollapsed = true) {
    const section = document.getElementById(sectionId);
    const toggleEl = document.getElementById(toggleId);
    const contentEl = document.getElementById(contentId);
    if (!section || !toggleEl || !contentEl) return;
    setCollapsed(toggleEl, contentEl, defaultCollapsed);
    toggleEl.addEventListener('click', () => {
        const current = toggleEl.dataset.collapsed === 'true';
        setCollapsed(toggleEl, contentEl, !current);
    });
}

function formatTimestamp(ts) {
    if (ts === null || ts === undefined) return '-';
    const num = Number(ts);
    if (!isFinite(num) || num === 0) return '-';
    const ms = num > 1e12 ? num : num * 1000;
    return new Date(ms).toLocaleString('en-US');
}

// Helper function to multiply a string number by power of 10
function multiplyStringByPowerOf10(numStr, power) {
    if (!numStr || numStr === '0') return '0';
    // Remove any non-digit characters except minus sign
    let cleanStr = numStr.toString().replace(/[^0-9-]/g, '');
    if (cleanStr === '' || cleanStr === '-') return '0';
    
    // If power is 0, return as is
    if (power === 0) return cleanStr;
    
    // If power is positive, append zeros
    if (power > 0) {
        return cleanStr + '0'.repeat(power);
    }
    
    // If power is negative, we'd need to handle decimals, but for our case we only need positive
    return cleanStr;
}

// Helper function to add two string numbers
function addStrings(a, b) {
    // Remove any non-digit characters except minus sign
    let aClean = a.toString().replace(/[^0-9-]/g, '');
    let bClean = b.toString().replace(/[^0-9-]/g, '');
    
    if (aClean === '' || aClean === '-') aClean = '0';
    if (bClean === '' || bClean === '-') bClean = '0';
    
    // Convert to BigInt for precise addition
    try {
        const aBig = BigInt(aClean);
        const bBig = BigInt(bClean);
        return (aBig + bBig).toString();
    } catch (e) {
        // Fallback to parseFloat if BigInt fails
        return (parseFloat(aClean) + parseFloat(bClean)).toString();
    }
}

// Helper function to compare two string numbers
// Returns: positive if a > b, negative if a < b, 0 if equal
// For descending sort: return b - a, so return compareStrings(b, a)
function compareStrings(a, b) {
    // Remove any non-digit characters except minus sign
    let aClean = a.toString().replace(/[^0-9-]/g, '');
    let bClean = b.toString().replace(/[^0-9-]/g, '');
    
    if (aClean === '' || aClean === '-') aClean = '0';
    if (bClean === '' || bClean === '-') bClean = '0';
    
    // Handle negative numbers
    const aNegative = aClean.startsWith('-');
    const bNegative = bClean.startsWith('-');
    
    if (aNegative && !bNegative) return -1; // a is negative, b is positive
    if (!aNegative && bNegative) return 1;  // a is positive, b is negative
    
    // Remove minus sign for comparison
    if (aNegative) aClean = aClean.substring(1);
    if (bNegative) bClean = bClean.substring(1);
    
    // Compare lengths first (longer number is bigger if both positive)
    if (aClean.length !== bClean.length) {
        const result = aClean.length - bClean.length;
        return aNegative ? -result : result;
    }
    
    // If same length, compare lexicographically
    const result = aClean.localeCompare(bClean);
    return aNegative ? -result : result;
}

// Truncate address
function truncateAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

// Show error message
function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    setTimeout(() => {
        errorEl.style.display = 'none';
    }, 5000);
}

// Hide error message
function hideError() {
    document.getElementById('errorMessage').style.display = 'none';
}

// Show loading
function showLoading() {
    document.getElementById('loadingIndicator').style.display = 'block';
    document.getElementById('results').style.display = 'none';
}

// Hide loading
function hideLoading() {
    document.getElementById('loadingIndicator').style.display = 'none';
}

// Display account status
function displayAccountStatus(data) {
    document.getElementById('accountAddress').textContent = truncateAddress(data.address);
    document.getElementById('accountAddress').title = data.address;
    
    const statusEl = document.getElementById('accountStatus');
    if (data.playerState) {
        statusEl.textContent = '✅ Active Player';
        statusEl.className = 'value badge success';
    } else {
        statusEl.textContent = '⚠️ Not Initialized';
        statusEl.className = 'value badge warning';
    }
}

// Calculate fishing income estimation based on historical data
function calculateFishingEstimation(playerState, config) {
    console.log('[Fishing Estimation] Calculating estimation...');
    console.log('[Fishing Estimation] playerState:', playerState);
    console.log('[Fishing Estimation] config:', config);
    
    if (!playerState || !config) {
        console.log('[Fishing Estimation] Missing playerState or config');
        return {
            perHour: '0.00',
            per6Hours: '0.00',
            per12Hours: '0.00',
            per24Hours: '0.00'
        };
    }
    
    // Get cast count and fish caught (both are strings from BN)
    // cast_count is a raw number (no decimals)
    // fish_caught_all_time is in raw format with 6 decimals
    const castCountStr = String(playerState.cast_count || '0');
    const fishCaughtAllTimeStr = String(playerState.fish_caught_all_time || '0');
    
    console.log('[Fishing Estimation] castCountStr:', castCountStr, 'type:', typeof castCountStr);
    console.log('[Fishing Estimation] fishCaughtAllTimeStr:', fishCaughtAllTimeStr, 'type:', typeof fishCaughtAllTimeStr);
    
    // Parse as numbers (handle large numbers safely)
    // For very large numbers, parseFloat might lose precision, but should work for reasonable values
    let castCount = 0;
    if (castCountStr && castCountStr !== '0' && castCountStr !== '') {
        const parsed = parseFloat(castCountStr);
        if (!isNaN(parsed) && isFinite(parsed)) {
            castCount = parsed;
        }
    }
    
    // fish_caught_all_time is in raw format (6 decimals), so divide by 10^6 to get FISH tokens
    let fishCaughtAllTimeRaw = 0;
    if (fishCaughtAllTimeStr && fishCaughtAllTimeStr !== '0' && fishCaughtAllTimeStr !== '') {
        const parsed = parseFloat(fishCaughtAllTimeStr);
        if (!isNaN(parsed) && isFinite(parsed)) {
            fishCaughtAllTimeRaw = parsed;
        }
    }
    const fishCaughtAllTime = fishCaughtAllTimeRaw / 1000000; // Divide by 10^6
    
    console.log('[Fishing Estimation] castCount:', castCount);
    console.log('[Fishing Estimation] fishCaughtAllTimeRaw:', fishCaughtAllTimeRaw);
    console.log('[Fishing Estimation] fishCaughtAllTime (FISH):', fishCaughtAllTime);
    
    // If no casts yet, can't estimate
    if (castCount === 0 || fishCaughtAllTime === 0) {
        console.log('[Fishing Estimation] No casts or fish caught, returning 0');
        return {
            perHour: '0.00',
            per6Hours: '0.00',
            per12Hours: '0.00',
            per24Hours: '0.00'
        };
    }
    
    // Calculate average fish per cast
    const avgFishPerCast = fishCaughtAllTime / castCount;
    console.log('[Fishing Estimation] avgFishPerCast:', avgFishPerCast);
    
    // Get cooldown in seconds
    let cooldownMs = config.basic_cooldown_ms || 0;
    
    // If cooldown is 0 or invalid, try to get from cached config or use default
    if (cooldownMs <= 0 && globalConfigCache && globalConfigCache.basic_cooldown_ms) {
        console.log('[Fishing Estimation] Using cached config cooldown');
        cooldownMs = globalConfigCache.basic_cooldown_ms;
    }
    
    // If still 0, use a reasonable default (e.g., 10 seconds = 10000ms)
    // This is a fallback in case config is not properly loaded
    if (cooldownMs <= 0) {
        console.warn('[Fishing Estimation] Cooldown is 0, using default 10 seconds');
        cooldownMs = 10000; // Default 10 seconds
    }
    
    const cooldownSeconds = cooldownMs / 1000;
    console.log('[Fishing Estimation] cooldownMs:', cooldownMs);
    console.log('[Fishing Estimation] cooldownSeconds:', cooldownSeconds);
    
    // Calculate casts per hour
    const castsPerHour = 3600 / cooldownSeconds;
    console.log('[Fishing Estimation] castsPerHour:', castsPerHour);
    
    // Calculate fish per hour
    const fishPerHour = avgFishPerCast * castsPerHour;
    console.log('[Fishing Estimation] fishPerHour:', fishPerHour);
    
    // Calculate estimates for different time periods
    const perHour = fishPerHour;
    const per6Hours = fishPerHour * 6;
    const per12Hours = fishPerHour * 12;
    const per24Hours = fishPerHour * 24;
    
    console.log('[Fishing Estimation] Final estimates - perHour:', perHour, 'per24Hours:', per24Hours);
    
    return {
        perHour: formatTokenAmount(perHour),
        per6Hours: formatTokenAmount(per6Hours),
        per12Hours: formatTokenAmount(per12Hours),
        per24Hours: formatTokenAmount(per24Hours)
    };
}

// Display player stats
function displayPlayerStats(playerState, config, fishSinceDiff, fishSinceDiffNote) {
    if (!playerState) {
        document.getElementById('playerStatsSection').style.display = 'none';
        return;
    }
    
    document.getElementById('playerStatsSection').style.display = 'block';
    document.getElementById('rodLevel').textContent = playerState.rod_level;
    document.getElementById('boatTier').textContent = playerState.boat_tier;
    document.getElementById('castCount').textContent = playerState.formatted.cast_count;
    document.getElementById('fishCaught').textContent = `${playerState.formatted.fish_caught_all_time} FISH`;
    document.getElementById('power').textContent = playerState.formatted.power;
    document.getElementById('durability').textContent = `${playerState.current_durability}/${playerState.max_durability}`;
    document.getElementById('supercast').textContent = playerState.supercast_remaining_casts;
    document.getElementById('unprocessedFish').textContent = `${playerState.formatted.unprocessed_fish} FISH`;

    // Fish since last difficulty change (provided by server)
    const sinceDiffEl = document.getElementById('fishSinceDiff');
    const sinceDiffNoteEl = document.getElementById('fishSinceDiffNote');
    if (sinceDiffEl) {
        if (fishSinceDiff !== null && fishSinceDiff !== undefined) {
            sinceDiffEl.textContent = `${fishSinceDiff} FISH`;
            if (sinceDiffNoteEl) sinceDiffNoteEl.textContent = fishSinceDiffNote || 'Sejak pergantian difficulty terakhir';
        } else {
            sinceDiffEl.textContent = '-';
            if (sinceDiffNoteEl) sinceDiffNoteEl.textContent = fishSinceDiffNote || 'Data belum tersedia (leaderboard perlu dimuat)';
        }
    }
    
    // Additional details
    if (playerState.upgrade_in_progress) {
        document.getElementById('upgradeProgress').textContent = `Yes (Target: Level ${playerState.upgrade_target_level}, Started at: ${playerState.formatted.upgrade_casts_at_start} casts)`;
    } else {
        document.getElementById('upgradeProgress').textContent = 'No';
    }
    
    document.getElementById('honeypot').textContent = playerState.is_honeypot ? '⚠️ Yes' : 'No';
    document.getElementById('firstFeePaid').textContent = playerState.first_process_fee_paid ? 'Yes' : 'No';
    document.getElementById('ataSubsidy').textContent = playerState.ata_subsidy_claimed ? 'Yes' : 'No';
    
    // Calculate and display fishing estimation
    // Use config from response, or fallback to cached global config
    const configToUse = config || globalConfigCache;
    if (configToUse) {
        const estimation = calculateFishingEstimation(playerState, configToUse);
        document.getElementById('fishingEstimationPerHour').textContent = `${estimation.perHour} FISH`;
        document.getElementById('fishingEstimationPer6Hours').textContent = `${estimation.per6Hours} FISH`;
        document.getElementById('fishingEstimationPer12Hours').textContent = `${estimation.per12Hours} FISH`;
        document.getElementById('fishingEstimationPer24Hours').textContent = `${estimation.per24Hours} FISH`;
    } else {
        // If config not available, show dashes
        document.getElementById('fishingEstimationPerHour').textContent = '-';
        document.getElementById('fishingEstimationPer6Hours').textContent = '-';
        document.getElementById('fishingEstimationPer12Hours').textContent = '-';
        document.getElementById('fishingEstimationPer24Hours').textContent = '-';
    }
}

// Display yield info
// Display honeypot warning
function displayHoneypotWarning(playerState) {
    const warningBanner = document.getElementById('honeypotWarning');
    if (!warningBanner) return;
    
    if (playerState && playerState.is_honeypot === true) {
        warningBanner.style.display = 'flex';
    } else {
        warningBanner.style.display = 'none';
    }
}

function displayYieldInfo(yieldInfo) {
    console.log('displayYieldInfo called with:', yieldInfo);
    const yieldSection = document.getElementById('yieldSection');
    
    if (!yieldSection) {
        console.error('Yield section element not found!');
        return;
    }
    
    // Always show yield section when address is searched
    yieldSection.style.display = 'block';
    
    // Display yield info, use default values if yieldInfo is null or empty
    let unclaimedYieldText = '0.00';
    let unprocessedFishText = '0.00';
    
    if (yieldInfo) {
        if (yieldInfo.formatted) {
            // Use formatted values if available
            unclaimedYieldText = yieldInfo.formatted.unclaimedYield || '0.00';
            unprocessedFishText = yieldInfo.formatted.unprocessedFish || '0.00';
        } else {
            // Try to get raw values and format them
            const unclaimedYield = yieldInfo.unclaimedYield;
            const unprocessedFish = yieldInfo.unprocessedFish;
            
            if (unclaimedYield !== undefined && unclaimedYield !== null) {
                unclaimedYieldText = typeof unclaimedYield === 'string' && unclaimedYield.includes('.') 
                    ? unclaimedYield 
                    : formatTokenAmount(unclaimedYield);
            }
            
            if (unprocessedFish !== undefined && unprocessedFish !== null) {
                unprocessedFishText = typeof unprocessedFish === 'string' && unprocessedFish.includes('.') 
                    ? unprocessedFish 
                    : formatTokenAmount(unprocessedFish);
            }
        }
    }
    
    document.getElementById('unclaimedYield').textContent = `${unclaimedYieldText} FISH`;
    document.getElementById('yieldUnprocessedFish').textContent = `${unprocessedFishText} FISH`;
    
    // Display fees information
    if (yieldInfo && yieldInfo.feesPerUnprocessedFish) {
        document.getElementById('feesPerUnprocessedFish').textContent = formatNumber(yieldInfo.feesPerUnprocessedFish);
    } else {
        document.getElementById('feesPerUnprocessedFish').textContent = '-';
    }
    
    if (yieldInfo && yieldInfo.lastClaimFeesSnapshot) {
        document.getElementById('lastClaimFeesSnapshot').textContent = formatNumber(yieldInfo.lastClaimFeesSnapshot);
    } else {
        document.getElementById('lastClaimFeesSnapshot').textContent = '-';
    }
}

// Display referrer info
function displayReferrerInfo(referrerInfo) {
    if (!referrerInfo) {
        document.getElementById('referrerSection').style.display = 'none';
        return;
    }
    
    document.getElementById('referrerSection').style.display = 'block';
    document.getElementById('referrerAddress').textContent = truncateAddress(referrerInfo.referrer);
    document.getElementById('referrerAddress').title = referrerInfo.referrer;
}

function displayNftStatus(nftConfig) {
    const section = document.getElementById('nftSection');
    if (!section) return;
    if (!nftConfig) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    const activeEl = document.getElementById('nftActive');
    if (activeEl) {
        activeEl.textContent = nftConfig.is_active ? 'Active' : 'Inactive';
        activeEl.className = `status-pill ${nftConfig.is_active ? 'pill-active' : 'pill-inactive'}`;
    }
    const collectionEl = document.getElementById('nftCollection');
    if (collectionEl) {
        collectionEl.textContent = truncateAddress(nftConfig.collection_mint);
        collectionEl.title = nftConfig.collection_mint;
    }
    const totalMintedEl = document.getElementById('nftTotalMinted');
    if (totalMintedEl) {
        totalMintedEl.textContent = `${nftConfig.formatted?.total_minted || formatTokenAmount(nftConfig.total_minted)} FISH`;
    }
    const activeSupplyEl = document.getElementById('nftActiveSupply');
    if (activeSupplyEl) {
        activeSupplyEl.textContent = `${nftConfig.formatted?.active_supply || formatTokenAmount(nftConfig.active_supply)} FISH`;
    }
    const gridSlotsEl = document.getElementById('nftGridSlots');
    if (gridSlotsEl) {
        gridSlotsEl.textContent = nftConfig.grid_total_slots || 0;
    }
    const typesCountEl = document.getElementById('nftTypes');
    if (typesCountEl) {
        typesCountEl.textContent = nftConfig.nft_types_count || 0;
    }
    const baitPriceList = document.getElementById('baitPriceList');
    if (baitPriceList) {
        const prices = nftConfig.formatted?.bait_prices || nftConfig.bait_prices || {};
        const entries = [
            { key: 'basic', label: 'Basic' },
            { key: 'premium', label: 'Premium' },
            { key: 'legendary', label: 'Legendary' },
            { key: 'mythic', label: 'Mythic' },
            { key: 'celestial', label: 'Celestial' }
        ];
        baitPriceList.innerHTML = entries.map(entry => {
            const value = prices[entry.key] ? formatTokenAmount(prices[entry.key]) : '-';
            return `<div class="list-row"><span>${entry.label}</span><span>${value} FISH</span></div>`;
        }).join('');
    }
}

function displayRiverConfig(riverConfig) {
    const section = document.getElementById('riverConfigSection');
    const content = document.getElementById('riverConfigContent');
    const toggle = document.getElementById('riverConfigToggle');
    if (!section) return;
    if (!riverConfig) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    if (content && toggle && toggle.dataset.collapsed === undefined) {
        // Keep default collapsed state on first render
        setCollapsed(toggle, content, true);
    }
    const activeEl = document.getElementById('riverActive');
    if (activeEl) {
        activeEl.textContent = riverConfig.is_active ? 'Active' : 'Inactive';
        activeEl.className = `status-pill ${riverConfig.is_active ? 'pill-active' : 'pill-inactive'}`;
    }
    const fishCountEl = document.getElementById('riverFishCount');
    if (fishCountEl) {
        fishCountEl.textContent = riverConfig.fish_count || 0;
    }
    const difficultyEl = document.getElementById('riverDifficultyRef');
    if (difficultyEl) {
        difficultyEl.textContent = riverConfig.formatted?.difficulty_ref || formatNumber(riverConfig.difficulty_ref || 0);
    }
    const baitTableBody = document.getElementById('riverBaitTableBody');
    if (baitTableBody) {
        const rows = (riverConfig.formatted?.baits || riverConfig.baits || []).filter(b => (b.casts_per_unit || 0) > 0).map((bait, idx) => {
            return `
                <tr>
                    <td>#${idx + 1}</td>
                    <td>Lvl ${bait.unlock_level}</td>
                    <td>${bait.casts_per_unit}</td>
                    <td>${bait.fish_cost_at_ref_difficulty_formatted || formatTokenAmount(bait.fish_cost_at_ref_difficulty || 0)} FISH</td>
                    <td>${bait.usdc_fee_formatted || formatTokenAmount(bait.usdc_fee || 0)} USDC</td>
                </tr>
            `;
        });
        baitTableBody.innerHTML = rows.length > 0 ? rows.join('') : '<tr><td colspan="5" class="no-data">No bait pricing configured</td></tr>';
    }
    const fishTableBody = document.getElementById('riverFishTableBody');
    if (fishTableBody) {
        const rows = (riverConfig.fish || []).slice(0, riverConfig.fish_count || 0).map(fish => {
            const rarity = fish.rarity_tier !== undefined ? fish.rarity_tier : '-';
            const rate = fish.catch_rate_ppb ? `${formatNumber(fish.catch_rate_ppb)} ppb` : '-';
            return `
                <tr>
                    <td>${fish.fish_id}</td>
                    <td>Bait ${fish.required_bait}</td>
                    <td>${rarity}</td>
                    <td>${rate}</td>
                </tr>
            `;
        });
        fishTableBody.innerHTML = rows.length > 0 ? rows.join('') : '<tr><td colspan="4" class="no-data">No river fish configured</td></tr>';
    }
}

function displayRiverState(riverState) {
    const section = document.getElementById('riverStateSection');
    if (!section) return;
    if (!riverState) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    const activeBaitEl = document.getElementById('riverActiveBait');
    if (activeBaitEl) {
        activeBaitEl.textContent = riverState.active_bait !== undefined ? `Bait ${riverState.active_bait}` : '-';
    }
    const castsList = document.getElementById('remainingCastsList');
    if (castsList) {
        const items = (riverState.remaining_casts || []).map((casts, idx) => ({ idx, casts })).filter(item => item.casts > 0);
        castsList.innerHTML = items.length > 0
            ? items.map(item => `<div class="list-row"><span>Bait ${item.idx}</span><span>${item.casts} casts left</span></div>`).join('')
            : '<div class="no-data">No active river baits</div>';
    }
    const pendingList = document.getElementById('pendingRiverList');
    if (pendingList) {
        const entries = [];
        const pending = riverState.pending || [];
        const head = riverState.pending_head || 0;
        const len = riverState.pending_len || 0;
        for (let i = 0; i < len; i++) {
            const idx = (head + i) % pending.length;
            const item = pending[idx];
            if (!item) continue;
            entries.push(item);
        }
        pendingList.innerHTML = entries.length > 0
            ? entries.map(item => `<div class="list-row"><span>Fish ${item.fish_id}</span><span>${formatTimestamp(item.timestamp)}</span></div>`).join('')
            : '<div class="no-data">No pending river catches</div>';
    }
}

function displayCollectionGrid(collectionGrid) {
    const section = document.getElementById('collectionGridSection');
    if (!section) return;
    if (!collectionGrid) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    const completed = collectionGrid.slots_completed_count || 0;
    const total = collectionGrid.total_slots || 0;
    const completedEl = document.getElementById('gridCompletedSlots');
    if (completedEl) {
        completedEl.textContent = `${completed}/${total}`;
    }
    const placedEl = document.getElementById('gridNftsPlaced');
    if (placedEl) {
        placedEl.textContent = collectionGrid.nfts_placed || 0;
    }
    const setsEl = document.getElementById('gridCompletedSets');
    if (setsEl) {
        setsEl.textContent = collectionGrid.completed_sets || 0;
    }
    const lastPlacementEl = document.getElementById('gridLastPlacement');
    if (lastPlacementEl) {
        lastPlacementEl.textContent = formatTimestamp(collectionGrid.last_placement_ts);
    }
    const progressBar = document.getElementById('gridProgressBar');
    const progressText = document.getElementById('gridProgressText');
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }
    if (progressText) {
        progressText.textContent = `${percent}% complete`;
    }
}

// Display emission predictions
function displayEmissionPredictions(prediction) {
    if (!prediction) {
        return; // Don't hide, just don't update
    }
    
    // Section is always visible, just update the data
    
    // Main emission data
    document.getElementById('actualEmission24h').textContent = `${formatTokenAmount(prediction.actualEmission24h)} FISH`;
    document.getElementById('dailyTargetEmission').textContent = `${formatTokenAmount(prediction.dailyTarget)} FISH`;
    
    // Difficulty prediction
    const difficultyCard = document.getElementById('difficultyCard');
    const difficultyPrediction = document.getElementById('difficultyPrediction');
    const difficultyStatus = document.getElementById('difficultyStatus');
    
    if (prediction.difficultyPrediction === 'up') {
        difficultyPrediction.textContent = '📈 DIFF WILL UP';
        difficultyPrediction.className = 'summary-value difficulty-up';
        difficultyStatus.textContent = `Emission is ${formatTokenAmount(Math.abs(prediction.emissionDiff))} FISH above target`;
        difficultyStatus.className = 'summary-status status-up';
        difficultyCard.style.borderColor = '#ef4444';
    } else if (prediction.difficultyPrediction === 'down') {
        difficultyPrediction.textContent = '📉 DIFF WILL DOWN';
        difficultyPrediction.className = 'summary-value difficulty-down';
        difficultyStatus.textContent = `Emission is ${formatTokenAmount(Math.abs(prediction.emissionDiff))} FISH below target`;
        difficultyStatus.className = 'summary-status status-down';
        difficultyCard.style.borderColor = '#10b981';
    } else {
        difficultyPrediction.textContent = '➡️ DIFF STABLE';
        difficultyPrediction.className = 'summary-value difficulty-stable';
        difficultyStatus.textContent = 'Emission matches target';
        difficultyStatus.className = 'summary-status status-stable';
        difficultyCard.style.borderColor = '#f59e0b';
    }
    
    // Details
    document.getElementById('totalFishMinted').textContent = `${formatTokenAmount(prediction.totalFishMinted)} FISH`;
    document.getElementById('totalUnprocessedFish').textContent = `${formatTokenAmount(prediction.totalUnprocessedFish)} FISH`;
    document.getElementById('periodStartFish').textContent = `${formatTokenAmount(prediction.periodStartFishCount)} FISH`;
    
    const emissionDiffEl = document.getElementById('emissionDiff');
    const diffValue = prediction.emissionDiff;
    if (diffValue > 0) {
        emissionDiffEl.textContent = `+${formatTokenAmount(diffValue)} FISH (Above target)`;
        emissionDiffEl.className = 'detail-value positive';
    } else if (diffValue < 0) {
        emissionDiffEl.textContent = `${formatTokenAmount(diffValue)} FISH (Below target)`;
        emissionDiffEl.className = 'detail-value negative';
    } else {
        emissionDiffEl.textContent = `${formatTokenAmount(diffValue)} FISH (On target)`;
        emissionDiffEl.className = 'detail-value neutral';
    }
}

// Display global stats
function displayGlobalStats(globalState) {
    if (!globalState) {
        return; // Don't hide, just don't update
    }
    
    // Section is always visible, just update the data
    document.getElementById('globalDifficulty').textContent = globalState.formatted?.current_difficulty || '-';
    document.getElementById('globalPower').textContent = globalState.formatted?.total_network_power || '-';
    document.getElementById('globalFishMinted').textContent = `${globalState.formatted?.total_fish_minted || '-'} FISH`;
    document.getElementById('globalUnprocessed').textContent = `${globalState.formatted?.total_unprocessed_fish || '-'} FISH`;
    document.getElementById('globalFogo').textContent = `${globalState.formatted?.total_fogo_collected || '-'} FOGO`;
    document.getElementById('globalFees').textContent = `${globalState.formatted?.accumulated_processing_fees || '-'} FISH`;
    
    // Emission settings
    document.getElementById('baseEmission').textContent = `${globalState.formatted?.base_emission_rate || '-'} FISH/block`;
    document.getElementById('dailyTarget').textContent = `${globalState.formatted?.daily_target_emission || '-'} FISH/day`;
    document.getElementById('halvingCount').textContent = globalState.halving_count || '-';
}

// Display emission predictions - updated to show only if globalState exists
function shouldShowEmission(data) {
    return data.globalState && data.emissionPrediction;
}

// Display config
function displayConfig(config) {
    if (!config) {
        return; // Don't hide, just don't update
    }
    
    // Section is always visible, just update the data
    document.getElementById('capCatch').textContent = config.require_capability_for_catch ? '✅ Yes' : '❌ No';
    document.getElementById('capSpend').textContent = config.require_capability_for_spend ? '✅ Yes' : '❌ No';
    document.getElementById('feeInit').textContent = config.require_fee_for_init ? '✅ Yes' : '❌ No';
    document.getElementById('softGate').textContent = config.soft_gate_mode ? '✅ Yes' : '❌ No';
    document.getElementById('cooldown').textContent = `${(config.basic_cooldown_ms / 1000).toFixed(1)}s`;
}

// Display PDAs
function displayPDAs(pdas) {
    document.getElementById('playerStatePDA').textContent = truncateAddress(pdas.playerState);
    document.getElementById('playerStatePDA').title = pdas.playerState;
    document.getElementById('referrerInfoPDA').textContent = truncateAddress(pdas.referrerInfo);
    document.getElementById('referrerInfoPDA').title = pdas.referrerInfo;
    const nftPdaEl = document.getElementById('nftConfigPDA');
    if (nftPdaEl && pdas.nftConfig) {
        nftPdaEl.textContent = truncateAddress(pdas.nftConfig);
        nftPdaEl.title = pdas.nftConfig;
    }
    const riverConfigPdaEl = document.getElementById('riverConfigPDA');
    if (riverConfigPdaEl && pdas.riverFishConfig) {
        riverConfigPdaEl.textContent = truncateAddress(pdas.riverFishConfig);
        riverConfigPdaEl.title = pdas.riverFishConfig;
    }
    const riverStatePdaEl = document.getElementById('riverStatePDA');
    if (riverStatePdaEl && pdas.riverFishState) {
        riverStatePdaEl.textContent = truncateAddress(pdas.riverFishState);
        riverStatePdaEl.title = pdas.riverFishState;
    }
    const gridPdaEl = document.getElementById('collectionGridPDA');
    if (gridPdaEl && pdas.collectionGrid) {
        gridPdaEl.textContent = truncateAddress(pdas.collectionGrid);
        gridPdaEl.title = pdas.collectionGrid;
    }
}

// Display recent mints
async function displayRecentMints() {
    const section = document.getElementById('recentMintsSection');
    if (!section) return;
    
    try {
        section.style.display = 'block';
        const tbody = document.getElementById('mintsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="4" class="loading-row">Loading recent mints...</td></tr>';
        
        const response = await fetch(`${API_BASE}/api/recent-mints?limit=20`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Failed to fetch recent mints' }));
            throw new Error(errorData.error || 'Failed to fetch recent mints');
        }
        
        const data = await response.json();
        
        if (data.mints && data.mints.length > 0) {
            tbody.innerHTML = data.mints.map(mint => {
                const signature = mint.signature || '';
                const escapedSignature = signature.replace(/'/g, "\\'");
                return `
                <tr>
                    <td class="time-cell">${mint.timeAgo || 'Unknown'}</td>
                    <td class="amount-cell">${mint.formatted.amount} FISH</td>
                    <td class="address-cell">
                        <span class="address-value" title="${mint.to}">${mint.formatted.to}</span>
                    </td>
                    <td class="signature-cell">
                        <span class="signature-value" title="${signature}">${mint.signatureShort}</span>
                        <button class="copy-btn-small" onclick="copyToClipboard('${escapedSignature}')" title="Copy signature">📋</button>
                    </td>
                </tr>
            `;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">No recent mints found</td></tr>';
        }
    } catch (error) {
        console.error('Error loading recent mints:', error);
        const tbody = document.getElementById('mintsTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="4" class="error-row">Failed to load recent mints: ${error.message}</td></tr>`;
        }
    }
}

// Copy to clipboard helper
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Visual feedback could be added here
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// Display all data (only called when address is entered)
function displayData(data) {
    hideLoading();
    hideError();
    
    console.log('displayData called with:', data);
    console.log('yieldInfo:', data.yieldInfo);
    
    // Show results container
    document.getElementById('results').style.display = 'block';
    
    // Show account status section
    const accountStatusSection = document.querySelector('.account-status');
    if (accountStatusSection) {
        accountStatusSection.style.display = 'block';
    }
    
    displayAccountStatus(data);
    displayHoneypotWarning(data.playerState);
    displayPlayerStats(data.playerState, data.config, data.fishSinceDiff, data.fishSinceDiffNote);
    displayYieldInfo(data.yieldInfo);
    displayReferrerInfo(data.referrerInfo);
    displayNftStatus(data.nftConfig);
    displayRiverConfig(data.riverFishConfig);
    displayRiverState(data.riverFishState);
    displayCollectionGrid(data.collectionGrid);
    
    // Global stats, config, emission, and PDAs are already loaded and displayed on page load
    // No need to update them here
}

// Load recent mints on page load
function loadRecentMintsOnLoad() {
    // Recent mints section is already visible in HTML
    // Just load the data
    displayRecentMints();
}

// Global config cache
let globalConfigCache = null;

// Global state cache
let globalStateCache = null;

// Load global data (emission, global stats, config, PDAs) on page load
async function loadGlobalDataOnLoad() {
    try {
        // Use a dummy address to get global data (playerState will be null, but globalState, config, etc. will be available)
        // Using a valid Solana address format but one that likely doesn't have a player state
        const dummyAddress = '11111111111111111111111111111111';
        
        const response = await fetch(`${API_BASE}/api/stats`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ address: dummyAddress })
        });
        
        if (!response.ok) {
            console.warn('Failed to load global data:', response.statusText);
            return;
        }
        
        const data = await response.json();
        
        // Cache config globally
        if (data.config) {
            globalConfigCache = data.config;
            console.log('[Global Config] Cached config:', globalConfigCache);
        }

        // Cache globalState globally
        if (data.globalState) {
            globalStateCache = data.globalState;
        }
        
        // Display global data (emission, global stats, config, PDAs)
        if (data.emissionPrediction) {
            displayEmissionPredictions(data.emissionPrediction);
        }
        
        if (data.globalState) {
            displayGlobalStats(data.globalState);
        }
        
        if (data.config) {
            displayConfig(data.config);
        }
        
        if (data.pdas) {
            displayPDAs(data.pdas);
        }
    } catch (error) {
        console.error('Error loading global data:', error);
    }
}


// Leaderboard state
let currentLeaderboardPage = 1;
const LEADERBOARD_PAGE_SIZE = 10;
let cachedLeaderboardData = null; // Cache untuk menyimpan data leaderboard
let currentSortType = 'unprocessed'; // 'unprocessed', 'yield', 'total', 'level'

// Load leaderboard from cache or API
async function loadLeaderboard(page = 1, forceRefresh = false) {
    try {
        const tbody = document.getElementById('leaderboardTableBody');
        if (!tbody) return;
        
        // If not refreshing and we have cached data, use cache
        if (!forceRefresh && cachedLeaderboardData) {
            console.log(`[Leaderboard] Using cached data for page ${page}`);
            displayLeaderboardPage(cachedLeaderboardData, page);
            return;
        }
        
        // Show loading only on refresh
        if (forceRefresh) {
            const colspan = currentSortType === 'total' ? 9 : 8;
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="loading-row">Refreshing leaderboard...</td></tr>`;
            
            // Call refresh endpoint to force server cache refresh
            try {
                const refreshResponse = await fetch(`${API_BASE}/api/leaderboard/refresh`, {
                    method: 'POST'
                });
                if (!refreshResponse.ok) {
                    console.warn('[Leaderboard] Refresh endpoint failed, using regular endpoint');
                }
            } catch (refreshError) {
                console.warn('[Leaderboard] Refresh endpoint error:', refreshError);
            }
        }
        
        const response = await fetch(`${API_BASE}/api/leaderboard`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch leaderboard');
        }
        
        const data = await response.json();

        // If server returned empty (still warming up), retry after 3 seconds
        if (!data.players || data.players.length === 0) {
            const tbody = document.getElementById('leaderboardTableBody');
            const colspan = currentSortType === 'total' ? 9 : 8;
            if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="loading-row">Loading leaderboard data... retrying in 3s</td></tr>`;
            setTimeout(() => loadLeaderboard(page, false), 3000);
            return;
        }
        
        // Cache the data
        cachedLeaderboardData = data;
        currentLeaderboardPage = page;
        
        // Display the requested page
        displayLeaderboardPage(data, page);
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        const tbody = document.getElementById('leaderboardTableBody');
        if (tbody) {
            const colspan = currentSortType === 'total' ? 9 : 8;
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="loading-row">Error loading leaderboard</td></tr>`;
        }
    }
}

// Sort players based on current sort type
function sortPlayers(players, sortType) {
    const sorted = [...players]; // Create a copy to avoid mutating original
    
    if (sortType === 'unprocessed') {
        sorted.sort((a, b) => {
            // Compare as strings for precision with large numbers
            const aStr = a.unprocessed_fish || '0';
            const bStr = b.unprocessed_fish || '0';
            
            // If strings have different lengths, longer is bigger
            if (aStr.length !== bStr.length) {
                return bStr.length - aStr.length;
            }
            
            // If same length, compare lexicographically (descending)
            return bStr.localeCompare(aStr);
        });
    } else if (sortType === 'yield') {
        sorted.sort((a, b) => {
            const aVal = parseFloat(a.yield_raw) || 0;
            const bVal = parseFloat(b.yield_raw) || 0;
            return bVal - aVal; // Descending
        });
    } else if (sortType === 'total') {
        sorted.sort((a, b) => {
            // Total = unprocessed_fish + yield_raw
            // unprocessed_fish is in raw format with 6 decimals (string)
            // yield_raw is in raw format with 18 decimals (string)
            // We need to convert both to the same scale for comparison
            
            // Use string manipulation for precision with large numbers
            const aUnprocessedStr = (a.unprocessed_fish || '0').toString();
            const bUnprocessedStr = (b.unprocessed_fish || '0').toString();
            const aYieldStr = (a.yield_raw || '0').toString();
            const bYieldStr = (b.yield_raw || '0').toString();
            
            // Convert unprocessed_fish (6 decimals) to 18 decimals scale for comparison
            // Multiply by 10^12 to convert from 6 decimals to 18 decimals
            // We'll work with strings to maintain precision
            const aUnprocessed18 = multiplyStringByPowerOf10(aUnprocessedStr, 12); // 10^12
            const bUnprocessed18 = multiplyStringByPowerOf10(bUnprocessedStr, 12); // 10^12
            
            // Now both are in 18 decimals scale, add them as strings
            const aTotal18 = addStrings(aUnprocessed18, aYieldStr);
            const bTotal18 = addStrings(bUnprocessed18, bYieldStr);
            
            // Compare the totals (both in 18 decimals scale)
            return compareStrings(bTotal18, aTotal18); // Descending
        });
    } else if (sortType === 'level') {
        sorted.sort((a, b) => {
            const aLevel = parseInt(a.rod_level) || 0;
            const bLevel = parseInt(b.rod_level) || 0;
            if (bLevel !== aLevel) return bLevel - aLevel; // Descending by level
            // Tiebreak: unprocessed_fish descending
            const aStr = a.unprocessed_fish || '0';
            const bStr = b.unprocessed_fish || '0';
            if (aStr.length !== bStr.length) return bStr.length - aStr.length;
            return bStr.localeCompare(aStr);
        });
    }
    
    return sorted;
}

// Display leaderboard page from cached data
function displayLeaderboardPage(data, page) {
    const tbody = document.getElementById('leaderboardTableBody');
    if (!tbody) return;
    
    // Sort players based on current sort type
    const sortedPlayers = sortPlayers(data.players, currentSortType);
    
    const limit = LEADERBOARD_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const total = sortedPlayers.length;
    const totalPages = Math.ceil(total / limit);
    
    // Update pagination
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (pageInfo) {
        pageInfo.textContent = `Page ${page} of ${totalPages}`;
    }
    if (prevBtn) {
        prevBtn.disabled = page <= 1;
    }
    if (nextBtn) {
        nextBtn.disabled = page >= totalPages;
    }
    
    // Show/hide Total column based on sort type
    const totalColumnHeader = document.getElementById('totalColumnHeader');
    const showTotalColumn = currentSortType === 'total';
    if (totalColumnHeader) {
        totalColumnHeader.style.display = showTotalColumn ? '' : 'none';
    }
    
    // Get players for current page
    const paginatedPlayers = sortedPlayers.slice(offset, offset + limit);
        
    // Display players
    if (paginatedPlayers && paginatedPlayers.length > 0) {
        tbody.innerHTML = '';
        paginatedPlayers.forEach((player, index) => {
            const rank = offset + index + 1;
            const row = document.createElement('tr');
            
            const addressShort = player.address.length > 20 
                ? player.address.slice(0, 8) + '...' + player.address.slice(-8)
                : player.address;
            
            const isHoneypot = player.is_honeypot === true || player.is_honeypot === 'true';
            const statusBadge = isHoneypot 
                ? '<span class="status-badge flagged" title="Flagged Account - Tokens may be burned">⚠️ Flagged</span>'
                : '<span class="status-badge normal">✓ Normal</span>';
            
            // Calculate total (unprocessed_fish + yield)
            // unprocessed_fish is in raw format with 6 decimals
            // yield_raw is in raw format with 18 decimals
            // So we need to divide by their respective decimals to get FISH tokens
            let totalCell = '';
            if (showTotalColumn) {
                const unprocessedRaw = parseFloat(player.unprocessed_fish) || 0;
                const yieldRaw = parseFloat(player.yield_raw) || 0;
                // unprocessed_fish: divide by 10^6 to get FISH tokens
                // yield_raw: divide by 10^18 to get FISH tokens (from server calculation)
                const unprocessedFish = unprocessedRaw / 1000000;
                const yieldFish = yieldRaw / 1000000000000000000; // 10^18
                const total = unprocessedFish + yieldFish;
                // Format total with 2 decimals
                const totalFormatted = formatTokenAmount(total);
                totalCell = `<td class="amount-cell total-column">${totalFormatted} FISH</td>`;
            }
            
            row.innerHTML = `
                <td class="rank-cell">#${rank}</td>
                <td class="address-cell copyable-address" data-address="${player.address}" title="Click to copy: ${player.address}" style="cursor: pointer; color: var(--primary-color);">${addressShort}</td>
                <td class="amount-cell">${player.unprocessed_fish_formatted} FISH</td>
                <td class="amount-cell">${player.yield} FISH</td>
                ${totalCell}
                <td>${player.power_formatted}</td>
                <td>${player.cast_count_formatted}</td>
                <td>Level ${player.rod_level}</td>
                <td>${statusBadge}</td>
            `;
            
            // Add click handler for copy
            const addressCell = row.querySelector('.copyable-address');
            if (addressCell) {
                addressCell.addEventListener('click', async () => {
                    const address = addressCell.getAttribute('data-address');
                    try {
                        await navigator.clipboard.writeText(address);
                        const originalText = addressCell.textContent;
                        addressCell.textContent = 'Copied!';
                        addressCell.style.color = '#10b981';
                        setTimeout(() => {
                            addressCell.textContent = originalText;
                            addressCell.style.color = 'var(--primary-color)';
                        }, 2000);
                    } catch (error) {
                        // Fallback
                        const textArea = document.createElement('textarea');
                        textArea.value = address;
                        textArea.style.position = 'fixed';
                        textArea.style.opacity = '0';
                        document.body.appendChild(textArea);
                        textArea.select();
                        try {
                            document.execCommand('copy');
                            const originalText = addressCell.textContent;
                            addressCell.textContent = 'Copied!';
                            addressCell.style.color = '#10b981';
                            setTimeout(() => {
                                addressCell.textContent = originalText;
                                addressCell.style.color = 'var(--primary-color)';
                            }, 2000);
                        } catch (err) {
                            alert('Failed to copy. Address: ' + address);
                        }
                        document.body.removeChild(textArea);
                    }
                });
            }
            
            tbody.appendChild(row);
        });
    } else {
        const colspan = showTotalColumn ? 9 : 8;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="loading-row">No players found</td></tr>`;
    }
}


// Switch sort type
function switchSortType(sortType) {
    currentSortType = sortType;
    currentLeaderboardPage = 1; // Reset to first page when switching sort
    
    // Update tab buttons
    const tabUnprocessed = document.getElementById('tabUnprocessed');
    const tabYield = document.getElementById('tabYield');
    const tabTotal = document.getElementById('tabTotal');
    const tabLevel = document.getElementById('tabLevel');
    const sortInfo = document.getElementById('leaderboardSortInfo');
    
    // Remove active class from all tabs
    if (tabUnprocessed) tabUnprocessed.classList.remove('active');
    if (tabYield) tabYield.classList.remove('active');
    if (tabTotal) tabTotal.classList.remove('active');
    if (tabLevel) tabLevel.classList.remove('active');
    
    // Add active class to selected tab and update info
    if (sortType === 'unprocessed') {
        if (tabUnprocessed) tabUnprocessed.classList.add('active');
        if (sortInfo) sortInfo.textContent = 'Ranked by Unprocessed Fish';
    } else if (sortType === 'yield') {
        if (tabYield) tabYield.classList.add('active');
        if (sortInfo) sortInfo.textContent = 'Ranked by Yield';
    } else if (sortType === 'total') {
        if (tabTotal) tabTotal.classList.add('active');
        if (sortInfo) sortInfo.textContent = 'Ranked by Total (Unprocessed + Yield)';
    } else if (sortType === 'level') {
        if (tabLevel) tabLevel.classList.add('active');
        if (sortInfo) sortInfo.textContent = 'Ranked by Rod Level';
    }
    
    // Re-display current page with new sort
    if (cachedLeaderboardData) {
        displayLeaderboardPage(cachedLeaderboardData, 1);
    } else {
        loadLeaderboard(1, false);
    }
}

// Load leaderboard on page load
function loadLeaderboardOnLoad() {
    // Leaderboard section is already visible in HTML
    // Setup tab listeners
    const tabUnprocessed = document.getElementById('tabUnprocessed');
    const tabYield = document.getElementById('tabYield');
    const tabTotal = document.getElementById('tabTotal');
    
    if (tabUnprocessed) {
        tabUnprocessed.addEventListener('click', () => switchSortType('unprocessed'));
    }
    if (tabYield) {
        tabYield.addEventListener('click', () => switchSortType('yield'));
    }
    if (tabTotal) {
        tabTotal.addEventListener('click', () => switchSortType('total'));
    }
    const tabLevel = document.getElementById('tabLevel');
    if (tabLevel) {
        tabLevel.addEventListener('click', () => switchSortType('level'));
    }
    
    loadLeaderboard(1, false); // Load from API on first load
}

// Fetch stats
async function fetchStats(address) {
    try {
        showLoading();
        hideError();
        
        const response = await fetch(`${API_BASE}/api/stats`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ address })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch stats');
        }
        
        const data = await response.json();
        displayData(data);
    } catch (error) {
        hideLoading();
        showError(error.message || 'An error occurred while fetching stats');
        console.error('Error:', error);
    }
}

// Donate address
const DONATE_ADDRESS = 'EbznKHvfEqmaTygeLv4oTjFGVdJsRiNu7tnssXERwypz';

// S2 Discord link
const S2_DISCORD_LINK = 'https://discord.com/channels/1438190845206593608/1438198173251272867/1458808576998113371';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Load recent mints on page load
    loadRecentMintsOnLoad();
    
    // Load leaderboard on page load
    loadLeaderboardOnLoad();
    
    // Load global data (emission, global stats, config, PDAs) on page load
    loadGlobalDataOnLoad();
    // Setup collapsible sections
    initCollapsible('riverConfigSection', 'riverConfigToggle', 'riverConfigContent', true);
    
    
    // Leaderboard pagination
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (currentLeaderboardPage > 1) {
                currentLeaderboardPage--;
                loadLeaderboard(currentLeaderboardPage, false); // Use cache
            }
        });
    }
    
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            currentLeaderboardPage++;
            loadLeaderboard(currentLeaderboardPage, false); // Use cache
        });
    }
    
    // S2 button click handler
    const s2Btn = document.getElementById('s2Btn');
    if (s2Btn) {
        s2Btn.addEventListener('click', () => {
            window.open(S2_DISCORD_LINK, '_blank');
        });
    }
    
    // Airdrop button click handler
    const airdropBtn = document.getElementById('airdropBtn');
    if (airdropBtn) {
        airdropBtn.addEventListener('click', () => {
            window.location.href = 'check-airdrop.html';
        });
    }
    
    // Donate button click handler
    const donateBtn = document.getElementById('donateBtn');
    if (donateBtn) {
        donateBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(DONATE_ADDRESS);
                const originalText = donateBtn.querySelector('.donate-text').textContent;
                donateBtn.querySelector('.donate-text').textContent = 'Copied!';
                donateBtn.style.backgroundColor = '#10b981';
                
                setTimeout(() => {
                    donateBtn.querySelector('.donate-text').textContent = originalText;
                    donateBtn.style.backgroundColor = '';
                }, 2000);
            } catch (error) {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = DONATE_ADDRESS;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    const originalText = donateBtn.querySelector('.donate-text').textContent;
                    donateBtn.querySelector('.donate-text').textContent = 'Copied!';
                    donateBtn.style.backgroundColor = '#10b981';
                    
                    setTimeout(() => {
                        donateBtn.querySelector('.donate-text').textContent = originalText;
                        donateBtn.style.backgroundColor = '';
                    }, 2000);
                } catch (err) {
                    alert('Failed to copy. Address: ' + DONATE_ADDRESS);
                }
                document.body.removeChild(textArea);
            }
        });
    }
    
    const searchBtn = document.getElementById('searchBtn');
    const addressInput = document.getElementById('addressInput');
    
    // Search button click
    if (searchBtn && addressInput) {
        searchBtn.addEventListener('click', () => {
            const address = addressInput.value.trim();
            if (!address) {
                showError('Please enter a wallet address');
                return;
            }
            fetchStats(address);
        });
        
        // Enter key press
        addressInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchBtn.click();
            }
        });
    } else {
        console.error('Search button or address input not found!');
    }
    
    // Refresh mints button
    const refreshMintsBtn = document.getElementById('refreshMintsBtn');
    if (refreshMintsBtn) {
        refreshMintsBtn.addEventListener('click', () => {
            displayRecentMints();
        });
    }
    
    // Copy address on click
    document.querySelectorAll('.address-value').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
            const fullAddress = el.title || el.textContent;
            navigator.clipboard.writeText(fullAddress).then(() => {
                const originalText = el.textContent;
                el.textContent = 'Copied!';
                setTimeout(() => {
                    el.textContent = originalText;
                }, 2000);
            });
        });
    });
});

