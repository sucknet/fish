// Donate address
const DONATE_ADDRESS = '85CbigB8Wihtg84inY5zKALyuWDKNUMcStYgtrdpjFuV';

// API endpoint for checking airdrop (using our proxy to avoid CORS issues)
const AIRDROP_API_BASE = '/api/fogo-airdrop-proxy';

// Store all results
let allResults = [];
let currentFilter = 'all';

// Format number with thousand separators
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Simplify allocation amount (divide by 10^9)
function simplifyAllocation(amount) {
    if (!amount) return 0;
    
    // Handle string numbers (they can be very large)
    const amountStr = amount.toString();
    
    // Remove any non-numeric characters
    const cleanAmount = amountStr.replace(/[^0-9]/g, '');
    
    if (!cleanAmount || cleanAmount === '0') return 0;
    
    // Divide by 1 billion (10^9) using string manipulation for precision
    // If the number is less than 9 digits, it will be less than 1 FOGO
    if (cleanAmount.length <= 9) {
        const decimal = parseFloat('0.' + cleanAmount.padStart(9, '0'));
        return parseFloat(decimal.toFixed(6));
    }
    
    // Split into whole and decimal parts
    const wholePart = cleanAmount.slice(0, cleanAmount.length - 9);
    const decimalPart = cleanAmount.slice(cleanAmount.length - 9);
    
    // Combine and parse
    const result = parseFloat(wholePart + '.' + decimalPart);
    
    return parseFloat(result.toFixed(6));
}

// Truncate address for display
function truncateAddress(address) {
    if (!address || address.length < 16) return address;
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

// Update progress bar
function updateProgress(current, total) {
    const progressSection = document.getElementById('progressSection');
    const progressFill = document.getElementById('progressFill');
    const progressCount = document.getElementById('progressCount');
    
    progressSection.style.display = 'block';
    progressCount.textContent = `${current} / ${total}`;
    
    const percentage = (current / total) * 100;
    progressFill.style.width = `${percentage}%`;
    
    if (current === total) {
        setTimeout(() => {
            progressSection.style.display = 'none';
        }, 1000);
    }
}

// Check single address
async function checkAddress(address) {
    try {
        const url = `${AIRDROP_API_BASE}?address=${encodeURIComponent(address)}`;
        
        console.log(`Checking address: ${address}`);
        console.log(`API URL: ${url}`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log(`Response status: ${response.status}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`HTTP error! status: ${response.status}, body: ${errorText}`);
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`Response for ${address}:`, JSON.stringify(data, null, 2));
        return data;
    } catch (error) {
        console.error(`Error checking address ${address}:`, error);
        console.error('Full error:', error.message, error.stack);
        return null;
    }
}

// Process all addresses
async function processAddresses(addresses) {
    allResults = [];
    let completed = 0;
    const total = addresses.length;
    
    // Process addresses one by one with a small delay to avoid rate limiting
    for (const address of addresses) {
        const result = await checkAddress(address);
        
        console.log(`Processing result for ${address}:`, result);
        
        if (result && result.identity) {
            // Has allocation
            let totalAmount = 0;
            let categories = [];
            
            if (result.allocations && result.allocations.length > 0) {
                result.allocations.forEach(alloc => {
                    categories.push(alloc.category || 'Unknown');
                });
            }
            
            if (result.totalAmount) {
                console.log(`Total amount before simplification: ${result.totalAmount}`);
                totalAmount = simplifyAllocation(result.totalAmount);
                console.log(`Total amount after simplification: ${totalAmount}`);
            }
            
            allResults.push({
                address: address,
                hasAllocation: totalAmount > 0,
                totalAmount: totalAmount,
                categories: categories,
                rawData: result
            });
        } else {
            // No allocation
            console.log(`No allocation found for ${address}`);
            allResults.push({
                address: address,
                hasAllocation: false,
                totalAmount: 0,
                categories: [],
                rawData: null
            });
        }
        
        completed++;
        updateProgress(completed, total);
        
        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return allResults;
}

// Display results in table
function displayResults(filter = 'all') {
    currentFilter = filter;
    const tbody = document.getElementById('resultsTableBody');
    tbody.innerHTML = '';
    
    let filteredResults = allResults;
    
    if (filter === 'withAllocation') {
        filteredResults = allResults.filter(r => r.hasAllocation);
    } else if (filter === 'noAllocation') {
        filteredResults = allResults.filter(r => !r.hasAllocation);
    }
    
    filteredResults.forEach((result, index) => {
        const row = document.createElement('tr');
        
        const categoryText = result.categories.length > 0 
            ? result.categories.join(', ') 
            : '-';
        
        const allocationText = result.hasAllocation 
            ? `${formatNumber(result.totalAmount.toFixed(2))} FOGO`
            : '-';
        
        const statusBadge = result.hasAllocation
            ? '<span class="status-badge success">✓ Eligible</span>'
            : '<span class="status-badge danger">✗ Not Eligible</span>';
        
        row.innerHTML = `
            <td class="index-cell">${index + 1}</td>
            <td class="address-cell" title="${result.address}">${truncateAddress(result.address)}</td>
            <td class="category-cell">${categoryText}</td>
            <td class="allocation-cell">${allocationText}</td>
            <td>${statusBadge}</td>
        `;
        
        tbody.appendChild(row);
    });
}

// Update summary
function updateSummary() {
    const totalChecked = allResults.length;
    const withAllocation = allResults.filter(r => r.hasAllocation).length;
    const noAllocation = allResults.filter(r => !r.hasAllocation).length;
    const totalAllocationSum = allResults.reduce((sum, r) => sum + r.totalAmount, 0);
    
    console.log('Summary - Total Allocation Sum:', totalAllocationSum);
    console.log('All Results:', allResults);
    
    document.getElementById('totalChecked').textContent = totalChecked;
    document.getElementById('totalWithAllocation').textContent = withAllocation;
    document.getElementById('totalNoAllocation').textContent = noAllocation;
    document.getElementById('totalAllocationSum').textContent = `${formatNumber(totalAllocationSum.toFixed(2))} FOGO`;
    
    document.getElementById('summarySection').style.display = 'block';
}

// Export to CSV
function exportToCSV() {
    const headers = ['Address', 'Category', 'Allocation (FOGO)', 'Status'];
    const rows = allResults.map(result => {
        const category = result.categories.length > 0 ? result.categories.join('; ') : 'N/A';
        const allocation = result.totalAmount;
        const status = result.hasAllocation ? 'Eligible' : 'Not Eligible';
        
        return [
            result.address,
            category,
            allocation,
            status
        ];
    });
    
    let csvContent = headers.join(',') + '\n';
    rows.forEach(row => {
        csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `fogo-airdrop-results-${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Main check function
async function checkAllocations() {
    const input = document.getElementById('addressesInput').value.trim();
    
    if (!input) {
        showError('Please enter at least one address');
        return;
    }
    
    // Parse addresses (one per line)
    const addresses = input
        .split('\n')
        .map(addr => addr.trim())
        .filter(addr => addr.length > 0);
    
    if (addresses.length === 0) {
        showError('No valid addresses found');
        return;
    }
    
    // Validate addresses (basic Solana address validation)
    const invalidAddresses = addresses.filter(addr => {
        // Solana addresses are base58 encoded and typically 32-44 characters
        return addr.length < 32 || addr.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr);
    });
    
    if (invalidAddresses.length > 0) {
        showError(`Found ${invalidAddresses.length} invalid address(es). Please check your input.`);
        return;
    }
    
    hideError();
    
    // Disable button and show loading
    const checkBtn = document.getElementById('checkBtn');
    const btnText = checkBtn.querySelector('.btn-text');
    const btnLoader = checkBtn.querySelector('.btn-loader');
    
    checkBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline';
    
    // Hide previous results
    document.getElementById('summarySection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
    
    try {
        // Process all addresses
        await processAddresses(addresses);
        
        // Update summary and display results
        updateSummary();
        displayResults('all');
        
        // Show results section
        document.getElementById('resultsSection').style.display = 'block';
    } catch (error) {
        showError('An error occurred while checking allocations. Please try again.');
        console.error('Error:', error);
    } finally {
        // Re-enable button
        checkBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoader.style.display = 'none';
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check button
    const checkBtn = document.getElementById('checkBtn');
    if (checkBtn) {
        checkBtn.addEventListener('click', checkAllocations);
    }
    
    // Quick action buttons
    const exampleBtn = document.getElementById('exampleBtn');
    if (exampleBtn) {
        exampleBtn.addEventListener('click', () => {
            const exampleAddresses = `4JV8JduEWiKZASJRAkHnyHCR7jVvp99vgjPoXxcssM7A
85CbigB8Wihtg84inY5zKALyuWDKNUMcStYgtrdpjFuV
FWXw8vgPEKVk8KZdNYXMPNBTWXLh5FjGJKXxPvRPpump`;
            document.getElementById('addressesInput').value = exampleAddresses;
        });
    }
    
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            document.getElementById('addressesInput').value = '';
            document.getElementById('summarySection').style.display = 'none';
            document.getElementById('resultsSection').style.display = 'none';
            allResults = [];
        });
    }
    
    const pasteBtn = document.getElementById('pasteBtn');
    if (pasteBtn) {
        pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                const currentValue = document.getElementById('addressesInput').value;
                if (currentValue) {
                    document.getElementById('addressesInput').value = currentValue + '\n' + text;
                } else {
                    document.getElementById('addressesInput').value = text;
                }
            } catch (error) {
                showError('Failed to read from clipboard. Please paste manually (Ctrl+V).');
            }
        });
    }
    
    // Back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            window.location.href = 'index.html';
        });
    }
    
    // Donate button
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
    
    // Filter buttons
    const filterAll = document.getElementById('filterAll');
    const filterWithAllocation = document.getElementById('filterWithAllocation');
    const filterNoAllocation = document.getElementById('filterNoAllocation');
    
    if (filterAll) {
        filterAll.addEventListener('click', () => {
            filterAll.classList.add('active');
            filterWithAllocation.classList.remove('active');
            filterNoAllocation.classList.remove('active');
            displayResults('all');
        });
    }
    
    if (filterWithAllocation) {
        filterWithAllocation.addEventListener('click', () => {
            filterAll.classList.remove('active');
            filterWithAllocation.classList.add('active');
            filterNoAllocation.classList.remove('active');
            displayResults('withAllocation');
        });
    }
    
    if (filterNoAllocation) {
        filterNoAllocation.addEventListener('click', () => {
            filterAll.classList.remove('active');
            filterWithAllocation.classList.remove('active');
            filterNoAllocation.classList.add('active');
            displayResults('noAllocation');
        });
    }
    
    // Export button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToCSV);
    }
    
    // Enter key on textarea
    const addressesInput = document.getElementById('addressesInput');
    if (addressesInput) {
        addressesInput.addEventListener('keydown', (e) => {
            // Ctrl+Enter or Cmd+Enter to check
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                checkAllocations();
            }
        });
    }
});
