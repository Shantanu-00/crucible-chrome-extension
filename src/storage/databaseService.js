// src/storage/databaseService.js
// LTP Builder Class
class LTPBuilder {
    constructor(databaseService) {
        this.dbService = databaseService;
        this.DECAY_CONSTANT = 1/30; // Decay over 30 days
        this.EWMA_ALPHA = 0.1; // Smoothing factor
        this.MAX_SESSIONS_FOR_CONFIDENCE = 8;
    }

    /**
     * Build or update LTP from STP
     */
// ❌ REMOVE THIS ENTIRE METHOD FROM LTPBuilder
// Emergency repair should ONLY be in DatabaseService

// Instead, handle errors gracefully:
async buildLTP(stpData) {
    try {
        console.log('🔨 LTPBuilder: Building/Updating LTP from STP:', stpData.session_id);
        
        // Get current profile and LTP
        const profile = await this.dbService.getProfile();
        const currentLTP = profile.ltp || this.getEmptyLTP();
        
        let updatedLTP;
        
        if (currentLTP.sessions_seen === 0 || !currentLTP.last_updated) {
            console.log('❄️ LTPBuilder: Cold start - creating first LTP');
            updatedLTP = this.coldStartLTP(stpData);
        } else {
            console.log('🔄 LTPBuilder: Updating existing LTP');
            updatedLTP = await this.updateLTP(currentLTP, stpData);
        }
        
        // Save updated LTP to profile
        await this.saveLTPToProfile(updatedLTP);
        
        return updatedLTP;
        
    } catch (error) {
        console.error('❌ LTPBuilder: Failed to build LTP:', error);
        
        // ✅ If profile is corrupted, let DatabaseService handle repair
        if (error.message.includes('profile') || error.message.includes('getProfile')) {
            console.log('🔧 Triggering database repair from LTPBuilder...');
            await this.dbService.emergencyProfileRepair();
        }
        
        throw error; // Re-throw to let caller handle
    }
}

    /**
     * Cold Start - Create first LTP from STP
     */
    coldStartLTP(stp) {
        // Only create LTP if session quality is good enough
        if (stp.engagement_confidence < 0.5) {
            console.log('⚠️ LTPBuilder: Session quality too low for cold start LTP');
            return this.getEmptyLTP();
        }

        // Convert STP topic cumulative to raw scores for LTP
        const topicCumulative = {};
        if (stp.topic_cumulative && typeof stp.topic_cumulative === 'object') {
            Object.keys(stp.topic_cumulative).forEach(topic => {
                const topicData = stp.topic_cumulative[topic];
                if (topicData && typeof topicData === 'object' && topicData.rawScore !== undefined) {
                    topicCumulative[topic] = topicData.rawScore;
                }
            });
        }

        // Calculate depth preference from diversity entropy
        const depth_preference = 1 - (stp.diversity_entropy || 0.5);

        const ltp = {
            topic_cumulative: topicCumulative,
            sessions_seen: 1,
            ewma_focus: stp.engagement_confidence || 0.5,
            ewma_depth: depth_preference,
            intent_aggregate: stp.intent_scores ? { ...stp.intent_scores } : {},
            last_updated: stp.calculated_at || new Date().toISOString(),
            confidence: 1 / this.MAX_SESSIONS_FOR_CONFIDENCE
        };

        console.log('❄️ LTPBuilder: Cold start LTP created', {
            topics: Object.keys(ltp.topic_cumulative).length,
            focus: ltp.ewma_focus,
            depth: ltp.ewma_depth,
            sessions_seen: ltp.sessions_seen
        });

        return ltp;
    }

    /**
     * Update existing LTP with new STP data
     */
    async updateLTP(currentLTP, newSTP) {
        // Calculate time decay
        const timeDecayFactor = this.calculateTimeDecay(currentLTP.last_updated, newSTP.calculated_at);
        
        console.log('⏰ LTPBuilder: Time decay calculation', {
            last_updated: currentLTP.last_updated,
            new_calculated_at: newSTP.calculated_at,
            decay_factor: timeDecayFactor
        });

        // Step 1: Time-Decay the old LTP scores
        const decayedTopicScores = this.applyTimeDecay(currentLTP.topic_cumulative, timeDecayFactor);
        
        // Step 2: Merge new STP scores (weighted by engagement confidence)
        const mergedTopicScores = this.mergeTopicScores(
            decayedTopicScores, 
            newSTP, 
            newSTP.engagement_confidence || 0.5
        );

        // Step 3: Update EWMA averages
        const updatedFocus = this.updateEWMA(
            currentLTP.ewma_focus, 
            newSTP.engagement_confidence, 
            this.EWMA_ALPHA
        );
        
        const depth_preference = 1 - (newSTP.diversity_entropy || 0.5);
        const updatedDepth = this.updateEWMA(
            currentLTP.ewma_depth, 
            depth_preference, 
            this.EWMA_ALPHA
        );

        // Step 4: Update intent aggregates with EWMA
        const updatedIntentAggregate = this.updateIntentAggregate(
            currentLTP.intent_aggregate || {},
            newSTP.intent_scores || {},
            this.EWMA_ALPHA
        );

        // Step 5: Update session count and confidence
        const shouldCountSession = newSTP.engagement_confidence >= 0.5;
        const updatedSessionsSeen = shouldCountSession ? currentLTP.sessions_seen + 1 : currentLTP.sessions_seen;
        const updatedConfidence = Math.min(1, updatedSessionsSeen / this.MAX_SESSIONS_FOR_CONFIDENCE);

        const updatedLTP = {
            topic_cumulative: mergedTopicScores,
            sessions_seen: updatedSessionsSeen,
            ewma_focus: updatedFocus,
            ewma_depth: updatedDepth,
            intent_aggregate: updatedIntentAggregate,
            last_updated: newSTP.calculated_at || new Date().toISOString(),
            confidence: updatedConfidence
        };

        console.log('🔄 LTPBuilder: LTP updated', {
            old_sessions: currentLTP.sessions_seen,
            new_sessions: updatedSessionsSeen,
            confidence: updatedConfidence,
            focus_old: currentLTP.ewma_focus,
            focus_new: updatedFocus,
            depth_old: currentLTP.ewma_depth,
            depth_new: updatedDepth
        });

        return updatedLTP;
    }

    /**
     * Calculate time decay factor based on days elapsed
     */
    calculateTimeDecay(lastUpdated, newTimestamp) {
        if (!lastUpdated) return 1; // No decay if no previous timestamp
        
        try {
            const lastDate = new Date(lastUpdated);
            const newDate = new Date(newTimestamp || new Date().toISOString());
            
            const timeDiffMs = newDate - lastDate;
            const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);
            
            // Exponential decay: e^(-λ * Δt)
            const decayFactor = Math.exp(-this.DECAY_CONSTANT * timeDiffDays);
            
            return Math.max(0, Math.min(1, decayFactor)); // Clamp between 0-1
            
        } catch (error) {
            console.error('❌ LTPBuilder: Error calculating time decay, using factor 1:', error);
            return 1;
        }
    }

    /**
     * Apply time decay to topic scores
     */
    applyTimeDecay(topicScores, decayFactor) {
        const decayedScores = {};
        
        Object.keys(topicScores).forEach(topic => {
            decayedScores[topic] = topicScores[topic] * decayFactor;
        });
        
        return decayedScores;
    }

    /**
     * Merge decayed LTP scores with new STP scores
     */
    mergeTopicScores(decayedLTPScores, newSTP, stpWeight) {
        const mergedScores = { ...decayedLTPScores };
        
        // Add new STP scores (weighted by engagement confidence)
        if (newSTP.topic_cumulative && typeof newSTP.topic_cumulative === 'object') {
            Object.keys(newSTP.topic_cumulative).forEach(topic => {
                const topicData = newSTP.topic_cumulative[topic];
                if (topicData && typeof topicData === 'object' && topicData.rawScore !== undefined) {
                    const stpRawScore = topicData.rawScore;
                    const weightedScore = stpRawScore * stpWeight;
                    
                    mergedScores[topic] = (mergedScores[topic] || 0) + weightedScore;
                }
            });
        }
        
        return mergedScores;
    }

    /**
     * Update EWMA (Exponentially Weighted Moving Average)
     */
    updateEWMA(oldValue, newValue, alpha) {
        if (newValue === undefined || newValue === null) return oldValue;
        
        return (1 - alpha) * oldValue + alpha * newValue;
    }

    /**
     * Update intent aggregate with EWMA for each intent type
     */
    updateIntentAggregate(oldIntents, newIntents, alpha) {
        const updatedIntents = { ...oldIntents };
        
        Object.keys(newIntents).forEach(intentType => {
            const newScore = newIntents[intentType];
            const oldScore = oldIntents[intentType] || 0;
            
            updatedIntents[intentType] = this.updateEWMA(oldScore, newScore, alpha);
        });
        
        return updatedIntents;
    }
/**
 * Save LTP to user profile - FIXED VERSION
 */
async saveLTPToProfile(ltpData) {
    try {
        // ✅ FIX: Use dbService reference
        let profile = await this.dbService.getProfile();
        profile.ltp = ltpData;
        profile.lastUpdated = new Date().toISOString();
        
        // ✅ ADD THIS VALIDATION
        this.validateProfileStructure(profile);
        
        // ✅ FIX: Use dbService.db reference
        await this.dbService.db.profile.put(profile, 'default');
        console.log('💾 LTP saved to profile');
        return { success: true };
    } catch (error) {
        console.error('❌ Profile validation failed:', error);
        
        // ✅ FIX: Call emergency repair on dbService
       
        
        // Retry once after repair
        try {
            let profile = await this.dbService.getProfile();
            profile.ltp = ltpData;
            profile.lastUpdated = new Date().toISOString();
            await this.dbService.db.profile.put(profile, 'default');
            return { success: true };
        } catch (retryError) {
            console.error('❌ Failed to save LTP after repair:', retryError);
            return { success: false, error: retryError.message };
        }
    }
}
// ✅ ADD: Validation method to LTPBuilder
validateProfileStructure(profile) {
    if (!profile.userId) profile.userId = 'default';
    if (!profile.lastUpdated) profile.lastUpdated = new Date().toISOString();
    
    if (profile.ltp) {
        const required = ['topic_cumulative', 'sessions_seen', 'ewma_focus', 'ewma_depth', 'confidence'];
        const missing = required.filter(field => profile.ltp[field] === undefined);
        
        if (missing.length > 0) {
            console.warn('🔄 LTP missing fields, resetting:', missing);
            profile.ltp = this.getEmptyLTP();
        }
    }
    return true;
}

    /**
     * Get empty LTP structure
     */
    getEmptyLTP() {
        return {
            topic_cumulative: {},
            sessions_seen: 0,
            ewma_focus: 0.5,
            ewma_depth: 0.5,
            intent_aggregate: {},
            last_updated: null,
            confidence: 0
        };
    }
    // In LTPBuilder class (for top topics)
getTopTopics(ltp, latestStp, limit = 5) {
  const ltpTopics = Object.entries(ltp.topic_cumulative || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([topic]) => topic);

  const stpTopics = Object.keys(latestStp?.topic_cumulative || {}).slice(0, limit);

  return {
    ltpTop: ltpTopics,
    stpTop: stpTopics,
    combined: [...new Set([...ltpTopics, ...stpTopics])].slice(0, limit)
  };
}

    /**
     * Get current LTP from profile
     */
    async getCurrentLTP() {
        const profile = await this.dbService.getProfile();
        return profile.ltp || this.getEmptyLTP();
    }

    /**
     * Get LTP summary for AI phrasing
     */
    getLTPSummary(ltp) {
        if (!ltp || ltp.sessions_seen === 0) {
            return "New user - still learning preferences";
        }

        // Find top topics
        const topics = Object.keys(ltp.topic_cumulative)
            .map(topic => ({
                topic,
                score: ltp.topic_cumulative[topic]
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);

        const topTopics = topics.map(t => t.topic).join(', ');
        
        // Determine focus level
        let focusLevel = "balanced";
        if (ltp.ewma_focus > 0.7) focusLevel = "highly focused";
        else if (ltp.ewma_focus < 0.3) focusLevel = "exploratory";

        // Determine depth preference
        let depthLevel = "balanced";
        if (ltp.ewma_depth > 0.7) depthLevel = "deep, analytical";
        else if (ltp.ewma_depth < 0.3) depthLevel = "broad, overview-focused";

        // Find dominant intent
        let dominantIntent = "general";
        let maxIntentScore = 0;
        if (ltp.intent_aggregate) {
            Object.keys(ltp.intent_aggregate).forEach(intent => {
                if (ltp.intent_aggregate[intent] > maxIntentScore) {
                    maxIntentScore = ltp.intent_aggregate[intent];
                    dominantIntent = intent;
                }
            });
        }

        return {
            summary: `User has ${focusLevel} engagement style with ${depthLevel} content preference. ` +
                    `Primary interests: ${topTopics}. ` +
                    `Typically seeks ${dominantIntent} content.`,
            confidence: ltp.confidence,
            sessions_analyzed: ltp.sessions_seen
        };
    }
}
class DatabaseService {
    constructor() {
        this.db = null;
        this.isInitialized = false;
        this.ltpBuilder = null;
        this.generateSummary = false; // NEW: Summary generation flag
        this.summaryGenerationInProgress = false;
    }

async initialize() {
    if (this.isInitialized) return this.db;

    try {
        if (typeof Dexie === 'undefined') {
            throw new Error('Dexie not available');
        }

        console.log('📦 DatabaseService: Initializing database...');

        this.db = new Dexie('ChromeWorldAI');

        // ✅ UPDATED SCHEMA - Clean and optimized
this.db.version(11).stores({
    // Core tables
    profile: 'userId, lastUpdated',
    sessions: 'sessionId, startTime, isActive',
    searches: '++id, searchId, query, timestamp, sessionId, tabId, source, resultsClicked, processed, intentType, topicDomains, confidence, specificity, aiModelUsed',
    snapshots: 'snapshotId, sessionId, timestamp, url, summary,insights',
    
    // ✅ CORRECTED URL behaviors table
    urlBehaviors: `
        ++id,
        sessionId,
        tabId,
        domain,
        url,
        startTime,
        endTime,
        activeTime,
        scrollDepth,
        clicks,
        copies,
        pastes,
        highlights,
        tabSwitches,
        engagementScore,
        contentSample,        
        topicDomains,
        topicInferenceSent,
        topicInferenceProcessing,
        lastUpdated,
        [sessionId+tabId+url],
        [sessionId+domain]
    `,
    
    // ✅ CORRECTED Domain behaviors table  
    domainBehaviors: `
        ++id,
        sessionId, 
        domain,
        startTime,
        endTime,
        totalActiveTime,
        urls,
        totalClicks,
        totalCopies,
        totalPastes,
        totalHighlights,
        totalTabSwitches,
        avgScrollDepth,
        avgEngagementScore,
        topicDistribution,
        lastUpdated,
        [sessionId+domain]
    `,
    
    aiQueue: `
        ++id,
        type,
        priority,
        createdAt,
        processed,
        processedAt,
        data
    `,
    
    systemState: 'key, value, lastUpdated'
});

        await this.db.open();
        await this.initializeDefaultProfile();
        
        // Initialize lastSession tracking
        await this.initializeLastSession();

        this.isInitialized = true;
         this.ltpBuilder = new LTPBuilder(this);
        console.log('📦 DatabaseService: Database initialized successfully');
        return this.db;
    } catch (error) {
        console.error('📦 DatabaseService: Initialization failed:', error);
        throw error;
    }
}

// Initialize last session tracking
async initializeLastSession() {
    const existing = await this.db.systemState.get('lastSessionId');
    if (!existing) {
        await this.db.systemState.put({
            key: 'lastSessionId',
            value: null,
            lastUpdated: new Date().toISOString()
        });
    }
}


async initializeDefaultProfile() {
    try {
        const existingProfile = await this.db.profile.get('default');
        if (!existingProfile) {
            await this.db.profile.add(this.getDefaultProfile());
            console.log('📦 DatabaseService: Default profile created');
        }
    } catch (error) {
        console.error('📦 DatabaseService: Profile initialization failed:', error);
        throw error;
    }
}

    // ---------------------------------
    // 🔹 Session operations
    // ---------------------------------
    async saveSession(sessionData) {
        await this.ensureInitialized();
        return await this.db.sessions.put(sessionData);
    }

    async getCurrentSession() {
        await this.ensureInitialized();
        return await this.db.sessions.where('isActive').equals(1).first();
    }

    

    // ---------------------------------
    // 🔹 Search tracking
    // ---------------------------------
    async saveSearch(searchData) {
        await this.ensureInitialized();
        
        const record = {
            searchId: searchData.searchId || `search-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            query: searchData.query,
            source: searchData.source || 'unknown',
            timestamp: searchData.timestamp || new Date().toISOString(),
            sessionId: searchData.sessionId || 'default-session',
            tabId: searchData.tabId || 'unknown',
            url: searchData.url || window?.location?.href || 'unknown',
            resultsClicked: [], // Initialize empty array for clicks
            processed: false,
            // AI fields (will be filled later)
            intentType: null,
            topicDomain: null,
            confidence: null,
            specificity: null,
           
            aiModelUsed: null
        };
        
        const id = await this.db.searches.add(record);
        
          await this.addToAIQueue({
        type: 'SEARCH_ENRICHMENT',
        priority: 2, // MEDIUM priority
        data: {
            searchId: record.searchId,
            query: record.query,
            sessionId: record.sessionId,
            tabId: record.tabId,
            source: record.source,
            url: record.url,
            timestamp: record.timestamp
        }
    });
    
    console.log('✅ Search saved and queued for AI processing');
        return { id, searchId: record.searchId };
    }
async saveSnapshot(snapshotData) {
  try {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const snapshotRecord = {
      snapshotId: snapshotData.snapshotId,
      sessionId: snapshotData.sessionId,
      timestamp: snapshotData.timestamp,
      url: snapshotData.url,
      summary: snapshotData.summary,
      insights: snapshotData.insights,
  

     
    };

    await this.db.snapshots.put(snapshotRecord);
    await this.incrementSnapshotCounter(); 
    console.log('📸 Snapshot saved to database:', {
      snapshotId: snapshotRecord.snapshotId,
      url: snapshotRecord.url,
      summaryLength: snapshotRecord.summary?.length,
      insightsCount: snapshotRecord.insights?.length || 0
    });

    return { success: true, snapshotId: snapshotRecord.snapshotId };
  } catch (error) {
    console.error('❌ Failed to save snapshot to database:', error);
    return { success: false, error: error.message };
  }
}
// Add to your DatabaseService class
/**
 * Enrich all unprocessed searches by query and remove matching AI queue tasks
 * @param {string} query - The search query to match
 * @param {object} enrichment - AI enrichment data
 * @param {string} [enrichedAt] - Optional timestamp
 */
async enrichSearchesByQuery(query, enrichment, enrichedAt) {
  await this.ensureInitialized();

  try {
    console.log('🔍 Enriching searches for query:', query);

    // Find all unprocessed searches with this query
    const matchingSearches = await this.db.searches
      .where('query')
      .equals(query)
      .filter(search => !search.processed)
      .toArray();

    if (matchingSearches.length === 0) {
      console.warn('⚠️ No unprocessed searches found for query:', query);
      return { success: false, error: 'No unprocessed searches found', query };
    }

    const updateData = {
      intentType: enrichment.intentType || null,
      topicDomains: enrichment.topicDomains || null, // Store weighted array
      confidence: enrichment.confidence || null,
      specificity: enrichment.specificity || null,
      searchComplexity: enrichment.searchComplexity || null,
      aiModelUsed: enrichment.aiModelUsed || 'gemini-Nano',
      processed: true,
      enrichedAt: enrichedAt || new Date().toISOString()
    };

    // Update all matching searches
    for (const search of matchingSearches) {
      await this.db.searches.update(search.id, updateData);
    }

    console.log(`✅ Enriched ${matchingSearches.length} searches with weighted topics for query:`, query, updateData.topicDomains);

    // Remove all matching AI queue tasks by query
    await this.removeAITasksByQuery(query);

    return {
      success: true,
      updatedCount: matchingSearches.length,
      query,
      updatedFields: updateData
    };

  } catch (error) {
    console.error('❌ Failed to enrich searches by query:', error);
    return { success: false, error: error.message, query };
  }
}
























async getLTPDashboardStats() {
    // 1. Ensure the database is initialized
    if (!this.isInitialized) await this.initialize();

    const result = {
        uniqueSearchesCount: 0,
        topDomainCount: 0, 
        totalActiveTime: '0m',
        snapshotCount: 0,
    };

    // --- 1. Total Active Time ---
   try {
    const allDomainRows = await this.db.domainBehaviors.toArray();
    const totalActiveSeconds = allDomainRows.reduce((acc, r) => {
        // totalActiveTime is stored in SECONDS, convert to minutes
        const v = Number(r.totalActiveTime) || 0; 
        return acc + v;
    }, 0);

    // Convert seconds to minutes for display
    const totalActiveMinutes = totalActiveSeconds / 60;
    
    // Convert total minutes to readable format (e.g., "1h 30m")
    const hours = Math.floor(totalActiveMinutes / 60);
    const remMins = Math.floor(totalActiveMinutes % 60);
    result.totalActiveTime = hours > 0 ? `${hours}h ${remMins}m` : `${remMins}m`;

} catch (err) {
    console.error('Error calculating total active time:', err);
}

    // --- 2. Snapshot Count ---
    try {
        const snapshots = await this.db.snapshots.toArray();
        // Count unique entries in the snapshots table
        result.snapshotCount = snapshots.length; 
        
        // NOTE: If you only want unique *sessions* that contain snapshots, you might 
        // need to group by a session ID, but counting the number of records is standard.
    } catch (err) {
        console.error('Error counting snapshots:', err);
    }
    
    // --- 3. Unique Searches Count ---
    try {
        const searches = await this.db.searches.toArray();
        // Count unique entries in the searches table
        result.uniqueSearchesCount = searches.length; 
    } catch (err) {
        console.error('Error counting unique searches:', err);
    }

    // --- 4. Top Domain Count (Interpreted as Top Topics Count from LTP) ---
    try {
        // Fetch profile to get LTP data
        const profileRow = await this.getProfile();
        const ltp = profileRow?.ltp || null;
        const topicCumulative = ltp?.topic_cumulative || null;

        // Default fraction for "top" topics
        const topFraction = 0.35; 

        if (topicCumulative && typeof topicCumulative === 'object') {
            // Convert topics object to an array and filter out non-numeric weights
            const topicsArr = Object.entries(topicCumulative)
                .map(([topic, weight]) => ({ topic, weight: Number(weight || 0) }))
                .filter(t => !isNaN(t.weight) && t.weight > 0);

            // Sort by weight descending
            topicsArr.sort((a, b) => b.weight - a.weight);

            // Determine the count for the top fraction
            const topN = Math.max(0, Math.ceil(topicsArr.length * topFraction));
            
            // Set the topDomainCount to the number of top topics
            result.topDomainCount = topN;
        } else {
            result.topDomainCount = 0;
        }
    } catch (err) {
        console.error('Error calculating top topics/domain count:', err);
    }

    // Return the four requested values
    return {
        uniqueSearchesCount: result.uniqueSearchesCount,
        topDomainCount: result.topDomainCount,
        totalActiveTime: result.totalActiveTime,
        snapshotCount: result.snapshotCount,
    };
}

/**
 * Gets dashboard stats based on the view (LTP or STP).
 * This function routes to the correct data source.
 * @param {string} view - 'ltp' or 'stp'
 * @returns {Promise<object>} - Dashboard stats object
 */
async getDashboardStats(view = 'ltp') {
    await this.ensureInitialized();

    if (view === 'stp') {
        // --- Get STP Stats ---
        const lastSTP = await this.getLastSTP(); // This function already exists in your file
        if (!lastSTP|| !lastSTP.session_id) {
            console.warn("getDashboardStats(stp): No lastSTP found.");
            return { snapshotCount: 0, totalActiveTime: '0m', uniqueSearchesCount: 0, topDomainCount: 0 };
        }

        // Fetch session-specific counts using the session ID
        const sessionSearches = await this.db.searches.where('sessionId').equals(lastSTP.session_id).count();
        const sessionSnapshots = await this.db.snapshots.where('sessionId').equals(lastSTP.session_id).count();
        
        const sessionLengthMin = lastSTP.session_length_min || 0;
        const hours = Math.floor(sessionLengthMin / 60);
        const remMins = Math.floor(sessionLengthMin % 60);

        return {
            snapshotCount: sessionSnapshots,
            totalActiveTime: hours > 0 ? `${hours}h ${remMins}m` : `${remMins}m`,
            uniqueSearchesCount: sessionSearches,
            // Get count of topics from the STP's topic map
            topDomainCount: Object.keys(lastSTP.topic_cumulative || {}).length
        };

    } else {
        // --- Get LTP Stats ---
        // Call the function you just renamed
        return this.getLTPDashboardStats();
    }
}

/**
 * Gets domain/topic behaviors based on the view for the "Topic Lattice".
 * @param {string} view - 'ltp' or 'stp'
 * @param {number} limit - Number of topics to return
 * @returns {Promise<Array<object>>} - Array of topic objects { topic, weight, score }
 */
async getDomainBehaviors(view = 'ltp', limit = 10) {
    await this.ensureInitialized();
    let topicMap = {};
    let isNormalized = false;

    if (view === 'stp') {
        const lastSTP = await this.getLastSTP();
        const stpTopics = lastSTP?.topic_cumulative || {};
        
        // Extract normalized weights from your enhanced STP structure
        Object.entries(stpTopics).forEach(([topic, data]) => {
            // data is { rawScore, normalizedWeight }
            topicMap[topic] = data.normalizedWeight || 0;
        });
        isNormalized = true; // STP topics are already normalized

    } else {
        // LTP stores cumulative raw scores, so they need normalization
        const profile = await this.getProfile();
        topicMap = profile?.ltp?.topic_cumulative || {};
        isNormalized = false;
    }

    // Normalize if it's the LTP raw score map
    if (!isNormalized) {
        const totalScore = Object.values(topicMap).reduce((s, v) => s + (v || 0), 0);
        if (totalScore > 0) {
            Object.keys(topicMap).forEach(key => {
                topicMap[key] = (topicMap[key] || 0) / totalScore;
            });
        }
    }
    
    // Sort, format, and return for the dashboard
    return Object.entries(topicMap)
        .map(([topic, weight]) => ({
            topic: topic,
            weight: weight,
            // 'score' is for the engagement-style % display
            score: Math.round(weight * 100) 
        }))
        .filter(t => t.score > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, limit);
}

/**
 * Gets profile data structured for the dashboard's "Profile Matrix" tab.
 * @param {string} view - 'ltp' or 'stp'
 * @returns {Promise<object>} - Profile data object
 */
async getUserProfile(view = 'ltp') {
    await this.ensureInitialized();
    const profile = await this.getProfile(); // This function exists
    const ltp = profile.ltp || {};
    const lastSTP = profile.lastSTP || {}; // This function exists
    
    // Your file saves summaries in 'profile.profileSummary'
    const summary = profile.profileSummary || this.getDefaultProfileSummary(); // This function exists

    if (view === 'stp') {
        // --- Build STP Profile Object ---
        const stpStats = await this.getDashboardStats('stp'); // Use our new function
        return {
            view: 'stp',
            summary: summary.stpSummary || "Current session analysis pending.",
            // Core Profile
            totalSnapshots: stpStats.snapshotCount,
            totalTime: stpStats.totalActiveTime,
            activeDays: lastSTP.session_id ? "1 Session" : "0 Sessions",
            // Nebula Vectors (Interests)
            interests: await this.getDomainBehaviors('stp', 12), // Use our new function
            // Behavior Arc
            behavior: this.formatStpBehavior(lastSTP.engagement_confidence),
            contentStyle: lastSTP.intent_focus || 'Unknown' // This is in your buildSTP
        };
    } else {
        // --- Build LTP Profile Object ---
        const ltpStats = await this.getDashboardStats('ltp'); // Use our new function
        return {
            view: 'ltp',
            summary: summary.ltpSummary || "Long-term profile analysis pending.",
            // Core Profile
            totalSnapshots: ltpStats.snapshotCount,
            totalTime: ltpStats.totalActiveTime,
            activeDays: ltp.sessions_seen || 0,
            // Nebula Vectors (Interests)
            interests: await this.getDomainBehaviors('ltp', 12), // Use our new function
            // Behavior Arc
            behavior: this.formatLtpBehavior(ltp.ewma_focus), // From ltpBuilder
            contentStyle: this.formatLtpDepth(ltp.ewma_depth) // From ltpBuilder
        };
    }
}

/**
 * Placeholder for fetching generated facts/insights.
 * @param {string} view - 'ltp' or 'stp'
 * @param {number} limit - Number of facts to return
 * @returns {Promise<Array<object>>}
 */
async getFacts(view = 'ltp', limit = 12) {
    await this.ensureInitialized();
    console.log(`Placeholder: getFacts(${view}, ${limit}) called`);
    // In a real app, you'd fetch from a 'facts' table
    // For the hackathon, returning a placeholder is fine.
    return [
        { statement: "Insight generation is an upcoming feature.", confidence: 0.9, createdAt: new Date().toISOString() },
        { statement: `Your ${view.toUpperCase()} profile is being analyzed.`, confidence: 0.8, createdAt: new Date().toISOString() }
    ];
}


// --- Profile Data Formatters (Helpers) ---

/**
 * Formats LTP focus score into a readable string.
 * @param {number} focus - ltp.ewma_focus (0.0 to 1.0)
 * @returns {string}
 */
formatLtpBehavior(focus) {
    if (focus == null) return "Balanced";
    if (focus > 0.7) return "Highly Focused";
    if (focus < 0.3) return "Exploratory";
    return "Balanced";
}

/**
 * Formats LTP depth score into a readable string.
 * @param {number} depth - ltp.ewma_depth (0.0 to 1.0)
 * @returns {string}
 */
formatLtpDepth(depth) {
    if (depth == null) return "Balanced";
    if (depth > 0.7) return "Deep, Analytical";
    if (depth < 0.3) return "Broad, Overview";
    return "Balanced";
}

/**
 * Formats STP engagement score into a readable string.
 * @param {number} engagement - lastSTP.engagement_confidence (0.0 to 1.0)
 * @returns {string}
 */
formatStpBehavior(engagement) {
    if (engagement == null) return "Medium Engagement";
    if (engagement > 0.7) return "High Engagement";
    if (engagement < 0.3) return "Low Engagement";
    return "Medium Engagement";
}



























    /**
     * Set summary generation flag and trigger background process
     */
async triggerSummaryGeneration() {
    if (this.summaryGenerationInProgress) {
        console.log('📝 Summary generation already in progress, skipping');
        return;
    }

    this.generateSummary = true;
    this.summaryGenerationInProgress = true;
    
    console.log('🚀 Triggering profile summary generation');
    
    try {
        // Direct method call since we're in the same context
        if (typeof backgroundService !== 'undefined' && backgroundService.handleProfileSummaryGeneration) {
            const result = await backgroundService.handleProfileSummaryGeneration({
                timestamp: new Date().toISOString(),
                sessionId: this.sessionId
            });
            console.log('✅ Profile summary generation triggered:', result);
        } else {
            console.warn('⚠️ Background service not available for direct call');
            // Reset flags if background service isn't available
            this.generateSummary = false;
            this.summaryGenerationInProgress = false;
        }
    } catch (error) {
        console.error('❌ Failed to trigger profile summary:', error);
        // Reset flags on error
        this.generateSummary = false;
        this.summaryGenerationInProgress = false;
    }
}  /**
     * Save individual LTP summary
     */
    async saveLTPSummary(ltpSummary) {
        try {
            const profile = await this.getProfile();
            
            if (!profile.summaries) {
                profile.summaries = {};
            }
            
            profile.summaries.ltpSummary = {
                summary: ltpSummary,
                generatedAt: new Date().toISOString(),
                sessionsSeen: profile.ltp?.sessions_seen || 0,
                confidence: profile.ltp?.confidence || 0
            };
            
            await this.saveProfile(profile);
            
            console.log('💾 LTP summary saved successfully');
            return { success: true };
        } catch (error) {
            console.error('❌ Failed to save LTP summary:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Save individual STP summary
     */
    async saveSTPSummary(stpSummary) {
        try {
            const profile = await this.getProfile();
            
            if (!profile.summaries) {
                profile.summaries = {};
            }
            
            profile.summaries.stpSummary = {
                summary: stpSummary,
                generatedAt: new Date().toISOString(),
                sessionId: profile.lastSTP?.session_id || 'current',
                dominantTopic: profile.lastSTP?.dominant_topic || 'unknown'
            };
            
            await this.saveProfile(profile);
            
            console.log('💾 STP summary saved successfully');
            return { success: true };
        } catch (error) {
            console.error('❌ Failed to save STP summary:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Save combined profile summary
     */
    async saveCombinedProfileSummary(combinedSummary, ltpSummary, stpSummary) {
        try {
            const profile = await this.getProfile();
            
            profile.profileSummary = {
                type: 'comprehensive',
                combinedSummary: combinedSummary,
                ltpSummary: ltpSummary,
                stpSummary: stpSummary,
                confidence: profile.ltp?.confidence || 0.5,
                sessionsAnalyzed: profile.ltp?.sessions_seen || 0,
                generatedAt: new Date().toISOString(),
                version: '1.0'
            };
            
            // Reset flags
            this.generateSummary = false;
            this.summaryGenerationInProgress = false;
            
            await this.saveProfile(profile);
            
            console.log('💾 Combined profile summary saved successfully', {
                confidence: profile.profileSummary.confidence
            });
            
            return { success: true };
        } catch (error) {
            console.error('❌ Failed to save combined profile summary:', error);
            // Reset flags even on error to allow retry
            this.generateSummary = false;
            this.summaryGenerationInProgress = false;
            return { success: false, error: error.message };
        }
    }

 /**
     * Save generated profile summary
     */
    async saveProfileSummary(summaryData) {
        try {
            const profile = await this.getProfile();
            
            profile.profileSummary = {
                ...summaryData,
                generatedAt: new Date().toISOString(),
                version: '1.0'
            };
            
            // Reset flags
            this.generateSummary = false;
            this.summaryGenerationInProgress = false;
            
            await this.saveProfile(profile);
            
            console.log('💾 Profile summary saved successfully', {
                summaryType: summaryData.type,
                confidence: summaryData.confidence
            });
            
            return { success: true };
        } catch (error) {
            console.error('❌ Failed to save profile summary:', error);
            // Reset flags even on error to allow retry
            this.generateSummary = false;
            this.summaryGenerationInProgress = false;
            return { success: false, error: error.message };
        }
    }
    async getLTPSummary() {
        const profile = await this.getProfile();
        return profile.summaries?.ltpSummary || { summary: "LTP analysis pending." };
    }

    async getSTPSummary() {
        const profile = await this.getProfile();
        return profile.summaries?.stpSummary || { summary: "STP analysis pending." };
    }
    /**
     * Get current profile summary
     */
    async getProfileSummary() {
        const profile = await this.getProfile();
        return profile.profileSummary || this.getDefaultProfileSummary();
    }

    /**
     * Get default profile summary when none exists
     */
    getDefaultProfileSummary() {
        return {
            type: 'default',
            combinedSummary: "New user - still learning preferences and behavior patterns.",
            ltpSummary: "Limited long-term data available.",
            stpSummary: "Current session data being collected.",
            confidence: 0.1,
            generatedAt: new Date().toISOString(),
            version: '1.0'
        };
    }

    /**
     * Check if summary generation is needed and trigger if required
     */
    async checkAndTriggerSummaryGeneration() {
        if (this.generateSummary && !this.summaryGenerationInProgress) {
            await this.triggerSummaryGeneration();
        }
    }



    // ---------------------------------
    // 🔹 Result click tracking
    // ---------------------------------
    async saveResultClick(clickData) {
        await this.ensureInitialized();
        
        console.log('💾 Appending result click:', {
            sessionId: clickData.sessionId,
            tabId: clickData.tabId, 
            query: clickData.query,
            resultUrl: clickData.resultUrl
        });
        
        // Find ALL matching search records
        const matchingSearches = await this.db.searches
            .where('sessionId').equals(clickData.sessionId || 'default-session')
            .and(search => search.tabId === clickData.tabId)
            .and(search => search.query === clickData.query)
            .toArray();

        if (matchingSearches.length === 0) {
            console.warn('❌ No matching search found for click');
            return { success: false, error: 'No matching search found' };
        }

        // Simply append resultUrl to each matching search
        const updatePromises = matchingSearches.map(async (search) => {
            const updatedClicks = [...(search.resultsClicked || []), clickData.resultUrl];
            return await this.db.searches.update(search.id, {
                resultsClicked: updatedClicks
            });
        });

        await Promise.all(updatePromises);
        
        console.log(`✅ Added result URL to ${matchingSearches.length} search records`);
        return { success: true, updatedCount: matchingSearches.length };
    }

    // ---------------------------------
    // 🔹 Get searches with their clicks
    // ---------------------------------
    async getRecentSearches(limit = 50) {
        await this.ensureInitialized();
        return await this.db.searches
            .orderBy('timestamp')
            .reverse()
            .limit(limit)
            .toArray();
    }

    async getSearchWithClicks(searchId) {
        await this.ensureInitialized();
        return await this.db.searches.where('searchId').equals(searchId).first();
    }





    // ---------------------------------
    // 🔹 BEHAVIOR TRACKING - NEW SEPARATE TABLES ARCHITECTURE
    // ---------------------------------

    /**
     * Save URL-level behavior data
     */
async saveBehaviorData(behaviorData) {
    if (!this.isInitialized) await this.initialize();

    try {
        // Validate required fields
        if (!behaviorData.sessionId || !behaviorData.tabId || !behaviorData.url || !behaviorData.domain) {
            throw new Error('Missing required fields: sessionId, tabId, url, or domain');
        }

        // Check if record exists to get current flags
        const existingRecord = await this.db.urlBehaviors
            .where('[sessionId+tabId+url]')
            .equals([behaviorData.sessionId, behaviorData.tabId, behaviorData.url])
            .first();

        // Prepare URL behavior data with flags
        const urlBehaviorData = {
            sessionId: behaviorData.sessionId,
            tabId: behaviorData.tabId,
            domain: behaviorData.domain,
            url: behaviorData.url,
            startTime: behaviorData.startTime,
            endTime: behaviorData.endTime || new Date().toISOString(),
            activeTime: behaviorData.engagement?.activeTime || 0,
            scrollDepth: behaviorData.engagement?.scrollDepth || 0,
            clicks: behaviorData.engagement?.clicks || 0,
            copies: behaviorData.engagement?.copies || 0,
            pastes: behaviorData.engagement?.pastes || 0,
            highlights: behaviorData.engagement?.highlights || 0,
            tabSwitches: behaviorData.engagement?.tabSwitches || 0,
            engagementScore: behaviorData.engagement?.engagementScore || 0,
            contentSample: behaviorData.contentSample || existingRecord?.contentSample || null,
            topicDomain: behaviorData.topicDomain || existingRecord?.topicDomain || null,
            // Preserve existing flags or initialize
            topicInferenceSent: existingRecord?.topicInferenceSent || false,
            topicInferenceProcessing: existingRecord?.topicInferenceProcessing || false,
            lastUpdated: new Date().toISOString()
        };

        let recordId;
        if (existingRecord) {
            // Update existing record
            recordId = existingRecord.id;
            await this.db.urlBehaviors.update(recordId, urlBehaviorData);
            console.log('✅ Updated existing URL behavior record:', {
                sessionId: behaviorData.sessionId,
                tabId: behaviorData.tabId,
                url: behaviorData.url,
                hasContentSample: !!urlBehaviorData.contentSample
            });
        } else {
            // Insert new record
            recordId = await this.db.urlBehaviors.add(urlBehaviorData);
            console.log('✅ Added new URL behavior record:', {
                sessionId: behaviorData.sessionId,
                tabId: behaviorData.tabId,
                url: behaviorData.url,
                hasContentSample: !!urlBehaviorData.contentSample
            });
        }

        // ✅ NEW: Check if we should add topic inference task
        await this.maybeAddTopicInferenceTask(
            recordId,
            behaviorData.sessionId,
            behaviorData.tabId,
            behaviorData.url,
            behaviorData.domain,
            urlBehaviorData.contentSample,
           urlBehaviorData.topicInferenceSent,
        urlBehaviorData.topicInferenceProcessing
        );

        // Check if we need to aggregate for previous session
        await this.checkAndAggregateDomainBehavior(behaviorData.sessionId);

        return { success: true, message: 'Behavior data saved successfully' };

    } catch (error) {
        console.error('❌ Failed to save behavior data:', error);
        return { success: false, error: error.message };
    }
}

// In DatabaseService - maybeAddTopicInferenceTask method
async maybeAddTopicInferenceTask(recordId, sessionId, tabId, url, domain, contentSample, inferenceSent, inferenceProcessing) {
    try {
        // ✅ CONDITIONS CHECK:
        // 1. Content sample exists and is valid
        const hasValidContent = contentSample && 
                               typeof contentSample === 'string' && 
                               contentSample.length > 100;
        
        // 2. Topic domain not already set
        const needsTopic = true; // We'll check this in the query
        
        // 3. Not already processing and not already sent
        const canProcess = !inferenceProcessing && !inferenceSent;

        if (!hasValidContent || !canProcess) {
            console.log('📄 Topic inference not needed or cannot process:', {
                hasValidContent,
                inferenceProcessing,
                inferenceSent
            });
            return;
        }

        // Double-check that topic domain is not already set
        const currentRecord = await this.db.urlBehaviors.get(recordId);
        if (currentRecord?.topicDomain && currentRecord.topicDomain !== 'unknown') {
            console.log('📄 Topic already inferred:', currentRecord.topicDomain);
            return;
        }

        console.log('🎯 Adding topic inference task to AI queue', {
            recordId,
            domain,
            contentLength: contentSample.length
        });

        // Prepare task data for AI processing
        const taskData = {
            type: 'TOPIC_INFERENCE',
            priority: 3, // LOW priority - background processing
            data: {
                recordId: recordId,
                sessionId: sessionId,
                tabId: tabId,
                url: url,
                domain: domain,
                contentSample: contentSample,
                 
                metadata: {
                    contentLength: contentSample.length,
                    domain: domain,
                    timestamp: new Date().toISOString()
                }
            }
        };

        // Add to AI queue
        const taskId = await this.addToAIQueue(taskData);
        
        // ✅ Update ONLY processing flag (sent flag remains false until topic arrives)
        await this.db.urlBehaviors.update(recordId, {
            topicInferenceProcessing: true, // 🔄 Processing started
            lastUpdated: new Date().toISOString()
        });

        console.log('✅ Topic inference task queued successfully', {
            taskId,
            recordId,
            domain
        });

        return taskId;

    } catch (error) {
        console.error('❌ Failed to add topic inference task:', error);
    }
}
 /**
     * Save Domain-level behavior data
     */

// Add these methods to your DatabaseService class

/**
 * Get searches by session ID
 */
async getSearchesBySession(sessionId, limit = 1000) {
    await this.ensureInitialized();
    try {
        const searches = await this.db.searches
            .where('sessionId')
            .equals(sessionId)
            .toArray();
        
        // Sort by timestamp descending and limit
        return searches
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, limit);
    } catch (error) {
        console.error('❌ Error getting searches by session:', error);
        return [];
    }
}

/**
 * Get URL behaviors by session ID
 */
async getUrlBehaviors(sessionId, limit = 1000) {
    await this.ensureInitialized();
    try {
        const behaviors = await this.db.urlBehaviors
            .where('sessionId')
            .equals(sessionId)
            .toArray();
        
        // Sort by lastUpdated descending and limit
        return behaviors
            .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
            .slice(0, limit);
    } catch (error) {
        console.error('❌ Error getting URL behaviors by session:', error);
        return [];
    }
}

/**
 * Get session by session ID
 */
async getSession(sessionId) {
    await this.ensureInitialized();
    try {
        return await this.db.sessions
            .where('sessionId')
            .equals(sessionId)
            .first();
    } catch (error) {
        console.error('❌ Error getting session:', error);
        return null;
    }
}

// Update the checkAndAggregateDomainBehavior method to include STP building
// Update the checkAndAggregateDomainBehavior method
// Update the checkAndAggregateDomainBehavior method
async checkAndAggregateDomainBehavior(currentSessionId) {
    try {
        const lastSessionState = await this.db.systemState.get('lastSessionId');
        const lastSessionId = lastSessionState?.value;

        // 🎯 CHECK FOR COLD START (no last session)
        if (!lastSessionId) {
        
            
            // Update last session to current session
            await this.db.systemState.put({
                key: 'lastSessionId',
                value: currentSessionId,
                lastUpdated: new Date().toISOString()
            });
            return; // Skip aggregation for first real session
        }

        // If same session, just update and return
        if (lastSessionId === currentSessionId) {
            await this.db.systemState.put({
                key: 'lastSessionId',
                value: currentSessionId,
                lastUpdated: new Date().toISOString()
            });
            return;
        }

        console.log('🔄 Aggregating domain behavior for previous session:', lastSessionId);

        // Get all URL behaviors for the previous session
        const urlBehaviors = await this.db.urlBehaviors
            .where('sessionId')
            .equals(lastSessionId)
            .toArray();

        if (urlBehaviors.length === 0) {
            console.log('📝 No URL behaviors found for previous session:', lastSessionId);
            // Still update lastSessionId to current session
            await this.db.systemState.put({
                key: 'lastSessionId',
                value: currentSessionId,
                lastUpdated: new Date().toISOString()
            });
            return;
        }

        // Group by domain
        const domainGroups = {};
        urlBehaviors.forEach(behavior => {
            if (!domainGroups[behavior.domain]) {
                domainGroups[behavior.domain] = [];
            }
            domainGroups[behavior.domain].push(behavior);
        });

        // Aggregate data for each domain
        for (const [domain, behaviors] of Object.entries(domainGroups)) {
            await this.aggregateDomainData(lastSessionId, domain, behaviors);
        }

        // ✅ Build and save STP for the completed session, then build LTP
        const stp = await this.buildAndSaveSTP(lastSessionId);
        
        if (stp && this.ltpBuilder) {
            console.log('🔨 Building LTP from completed session STP');
            await this.ltpBuilder.buildLTP(stp);
        }

        await this.triggerSummaryGeneration();
        await this.debugSummaryGeneration();

        // Update last session to current session after aggregation
        await this.db.systemState.put({
            key: 'lastSessionId',
            value: currentSessionId,
            lastUpdated: new Date().toISOString()
        });

        console.log('✅ Domain behavior aggregation completed for session:', lastSessionId);

    } catch (error) {
        console.error('❌ Domain behavior aggregation failed:', error);
    }
}
// Add to DatabaseService class
async debugSummaryGeneration() {
    console.log('🔍 Summary Generation Debug:');
    console.log('- generateSummary flag:', this.generateSummary);
    console.log('- summaryGenerationInProgress:', this.summaryGenerationInProgress);
    
    const profile = await this.getProfile();
    console.log('- LTP sessions seen:', profile.ltp?.sessions_seen || 0);
    console.log('- Last STP:', !!profile.lastSTP);
    console.log('- Profile summary exists:', !!profile.profileSummary);
    
    return {
        generateSummary: this.generateSummary,
        summaryGenerationInProgress: this.summaryGenerationInProgress,
        ltpSessions: profile.ltp?.sessions_seen || 0,
        hasLastSTP: !!profile.lastSTP,
        hasProfileSummary: !!profile.profileSummary
    };
}

async getTotalActiveTime(view = 'stp') {  // Sum durations from STP or LTP sessions_seen * avg
  await this.ensureInitialized();
  if (view === 'ltp') {
    const profile = await this.getProfile();
    const ltp = profile.ltp || {};
    return ltp.sessions_seen * 3600000;  // Assume avg 1h per session, adjust as needed
  } else {  // STP
    const stps = await this.db.sessions.toArray();
    return stps.reduce((sum, stp) => sum + (stp.duration || 0), 0);
  }
}

async getTopTopics(view = 'combined', limit = 5) {
  const profile = await this.getProfile();
  const ltp = profile.ltp || {};
  const latestStp = (await this.db.sessions.orderBy('calculated_at').reverse().first()) || {};
  return this.ltpBuilder.getTopTopics(ltp, latestStp, limit)[view];
}

// Snapshot counter (global)
async incrementSnapshotCounter() {
  await this.ensureInitialized();
  const current = await this.getSystemState('snapshotCounter') || 0;
  await this.setSystemState('snapshotCounter', current + 1);
  return current + 1;
}

async getSnapshotCounter() {
  return await this.getSystemState('snapshotCounter') || 0;
}


/**
 * Build and save STP for a completed session
 */
// Add these methods to your DatabaseService class - make sure they're inside the class

/**
 * Get intent multiplier for search queries
 */
getIntentMultiplier(intentType) {
    const multipliers = {
        'informational': 1.2,
        'transactional': 1.0,
        'instructional': 1.2,
        'navigational': 1.0
    };
    
    return multipliers[intentType?.toLowerCase()] || 1.0;
}

/**
 * Return empty STP when no data is available
 */
/**
 * Return empty STP when no data is available
 */
getEmptySTP(sessionId) {
    return {
        session_id: sessionId,
        session_length_min: 0,
        engagement_confidence: 0,
        diversity_entropy: 0,
        dominant_topic: 'General',
        intent_focus: 'unknown', // *** ADD THIS ***
        intent_scores: {}, // *** ADD THIS ***
        topic_cumulative: {},
        raw_evidence: [],
        calculated_at: new Date().toISOString()
    };
}

/**
 * Build temporary topic map for metrics calculation
 */
buildTemporaryTopicMap(searches, urlBehaviors) {
    const searchMap = this.buildSearchTopicMap(searches);
    const urlMap = this.buildUrlTopicMap(urlBehaviors);
    return this.mergeTopicMaps(searchMap, urlMap, 0.4, 0.6);
}
/**
 * Get normalized weights only (for backward compatibility)
 */
getNormalizedWeights(topicCumulative) {
    if (!topicCumulative || typeof topicCumulative !== 'object') {
        return {};
    }
    
    // Check if it's the new enhanced structure
    const firstTopic = Object.keys(topicCumulative)[0];
    if (firstTopic && topicCumulative[firstTopic] && typeof topicCumulative[firstTopic] === 'object') {
        // New structure: extract normalized weights
        const normalizedWeights = {};
        Object.keys(topicCumulative).forEach(topic => {
            normalizedWeights[topic] = topicCumulative[topic].normalizedWeight;
        });
        return normalizedWeights;
    } else {
        // Old structure: return as-is (assuming it's already normalized weights)
        return topicCumulative;
    }
}

/**
 * Get raw scores only from enhanced structure
 */
getRawScores(topicCumulative) {
    if (!topicCumulative || typeof topicCumulative !== 'object') {
        return {};
    }
    
    // Check if it's the new enhanced structure
    const firstTopic = Object.keys(topicCumulative)[0];
    if (firstTopic && topicCumulative[firstTopic] && typeof topicCumulative[firstTopic] === 'object') {
        // New structure: extract raw scores
        const rawScores = {};
        Object.keys(topicCumulative).forEach(topic => {
            rawScores[topic] = topicCumulative[topic].rawScore;
        });
        return rawScores;
    } else {
        // Old structure: raw scores not available, return normalized as raw (for compatibility)
        console.warn('⚠️ Raw scores not available in old STP structure, using normalized weights');
        return topicCumulative;
    }
}
/**
 * Find dominant topic from normalized topic map
 */
findDominantTopic(topicCumulative) {
    const normalizedWeights = this.getNormalizedWeights(topicCumulative);
    
    let maxScore = 0;
    let dominantTopic = 'General';
    
    Object.keys(normalizedWeights).forEach(topic => {
        const weight = normalizedWeights[topic];
        if (weight > maxScore) {
            maxScore = weight;
            dominantTopic = topic;
        }
    });
    
    return dominantTopic;
}

/**
 * Calculates the dominant intent and normalized intent scores for the session.
 */
calculateIntentFocus(searches) {
    const intentScores = {};
    let totalScore = 0;

    console.log('🎯 Calculating intent focus from searches:', searches.length);

    searches.forEach(search => {
        if (!search.processed || !search.intentType || 
            search.confidence == null || search.specificity == null) {
            return; // Skip invalid searches
        }
        
        const intent = search.intentType.toLowerCase();
        // Weight each intent by the search quality
        const qualityScore = (search.confidence * search.specificity);
        
        intentScores[intent] = (intentScores[intent] || 0) + qualityScore;
        totalScore += qualityScore;

        console.log('🔍 Search intent contribution:', {
            query: search.query,
            intent: intent,
            confidence: search.confidence,
            specificity: search.specificity,
            qualityScore: qualityScore,
            runningTotal: intentScores[intent]
        });
    });

    if (totalScore === 0) {
        console.log('⚠️ No valid intent data found, returning unknown');
        return { 
            dominant_intent: 'unknown', 
            intent_scores: {} 
        };
    }

    // Find the dominant intent
    let dominant_intent = 'unknown';
    let maxScore = 0;
    
    // Normalize the scores
    const normalizedScores = {};
    Object.keys(intentScores).forEach(intent => {
        const score = intentScores[intent] / totalScore;
        normalizedScores[intent] = this.roundToDecimal(score, 6);
        
        if (intentScores[intent] > maxScore) {
            maxScore = intentScores[intent];
            dominant_intent = intent;
        }
    });

    console.log('✅ Intent focus calculated:', {
        dominant_intent,
        intent_scores: normalizedScores,
        totalScore
    });

    return { 
        dominant_intent: dominant_intent, 
        intent_scores: normalizedScores  // This map is what the LTP needs
    };
}
/**
 * Build raw evidence array from searches and URLs
 */
buildRawEvidence(searches, urlBehaviors) {
    const evidence = [];
    
    // Add search queries
    searches.forEach(search => {
        if (search.query) {
            evidence.push(`query: ${search.query}`);
        }
    });
    
    // Add URL domains
    urlBehaviors.forEach(behavior => {
        if (behavior.domain) {
            evidence.push(`url: ${behavior.domain}`);
        }
    });
    
    return evidence.slice(0, 50); // Limit to 50 items
}

// Here's the complete corrected STP builder method with all dependencies:
/**
 * Build Short-Term Profile (STP) for a session with raw scores and normalized weights
 */
async buildSTP(sessionId) {
    await this.ensureInitialized();
    
    try {
        console.log(`🔨 Building STP for session: ${sessionId}`);
        
        // Fetch all data for the session
        const searches = await this.getSearchesBySession(sessionId);
        const urlBehaviors = await this.getUrlBehaviors(sessionId);
        const session = await this.getSession(sessionId);
        
        console.log('📊 Raw data fetched:', {
            searches: searches.length,
            urlBehaviors: urlBehaviors.length,
            session: !!session
        });
        
        if (!searches.length && !urlBehaviors.length) {
            console.warn('⚠️ No data found for session:', sessionId);
            return this.getEmptySTP(sessionId);
        }
        
        // Build topic maps from searches and URL behaviors
        const searchTopicMap = this.buildSearchTopicMap(searches);
        const urlTopicMap = this.buildUrlTopicMap(urlBehaviors);
        
        console.log('📈 Raw topic maps built:', {
            searchTopics: Object.keys(searchTopicMap).length,
            urlTopics: Object.keys(urlTopicMap).length
        });
        
        // Merge topic maps with 60% URL weight and 40% search weight - BUT DON'T NORMALIZE YET
        const rawTopicMap = this.mergeTopicMapsRaw(searchTopicMap, urlTopicMap, 0.4, 0.6);
        
        console.log('📈 Raw merged topic map (before normalization):', rawTopicMap);
        
        // Calculate session metrics (now includes intent data)
        const sessionMetrics = this.calculateSessionMetrics(searches, urlBehaviors);
        
        // Build enhanced topic cumulative with raw scores and normalized weights
        const topicCumulative = this.buildEnhancedTopicCumulative(rawTopicMap);
        
        // Build the final STP object with intent data
        const stp = {
            session_id: sessionId,
            session_length_min: sessionMetrics.sessionLengthMin,
            engagement_confidence: sessionMetrics.engagementConfidence,
            diversity_entropy: sessionMetrics.diversityEntropy,
            dominant_topic: sessionMetrics.dominantTopic,
            
            // *** ADD THESE NEW INTENT FIELDS: ***
            intent_focus: sessionMetrics.dominant_intent,
            intent_scores: sessionMetrics.intent_scores,
            
            topic_cumulative: topicCumulative,
            raw_evidence: this.buildRawEvidence(searches, urlBehaviors),
            calculated_at: new Date().toISOString()
        };
        
        console.log('✅ STP built successfully with intent focus:', {
            sessionId,
            topics: Object.keys(topicCumulative).length,
            dominantTopic: stp.dominant_topic,
            intentFocus: stp.intent_focus,
            intentScores: stp.intent_scores
        });
        
        return stp;
        
    } catch (error) {
        console.error('❌ Failed to build STP:', error);
        return this.getEmptySTP(sessionId);
    }
}
/**
 * Build topic map from search queries with null safety
 */
buildSearchTopicMap(searches) {
    const topicMap = {};
    let processedSearches = 0;
    
    searches.forEach(search => {
        // Skip unprocessed, invalid, or searches without topic domains
        if (!search.processed || 
            !search.topicDomains || 
            !Array.isArray(search.topicDomains) ||
            search.topicDomains.length === 0) {
            return;
        }
        
        // Skip if confidence or specificity are null/undefined
        if (search.confidence == null || search.specificity == null) {
            return;
        }
        
        // Calculate search quality score with null safety
        const intentMultiplier = this.getIntentMultiplier(search.intentType);
        const searchQuality = (search.specificity || 0) * (search.confidence || 0) * intentMultiplier;
        
        if (searchQuality <= 0) return;
        
        // Distribute search quality score across topics
        let validTopics = 0;
        search.topicDomains.forEach(topicDomain => {
            // Skip invalid topic domains
            if (!topicDomain || 
                !topicDomain.topic || 
                topicDomain.weight == null ||
                topicDomain.weight <= 0) {
                return;
            }
            
            const topic = topicDomain.topic.trim();
            if (!topic) return;
            
            const topicWeight = Math.max(0, Math.min(1, topicDomain.weight)); // Clamp between 0-1
            const wQuery = searchQuality * topicWeight;
            
            topicMap[topic] = (topicMap[topic] || 0) + wQuery;
            validTopics++;
        });
        
        if (validTopics > 0) {
            processedSearches++;
        }
    });
    
    console.log(`🔍 Processed ${processedSearches}/${searches.length} searches for topic mapping`);
    return topicMap;
}

mergeTopicMapsRaw(searchTopicMap, urlTopicMap, searchWeight, urlWeight) {
    const mergedMap = {};
    const allTopics = new Set([
        ...Object.keys(searchTopicMap),
        ...Object.keys(urlTopicMap)
    ]);
    
    // If both maps are empty, return empty
    if (allTopics.size === 0) {
        return {};
    }
    
    allTopics.forEach(topic => {
        const searchScore = searchTopicMap[topic] || 0;
        const urlScore = urlTopicMap[topic] || 0;
        mergedMap[topic] = (searchScore * searchWeight) + (urlScore * urlWeight);
    });
    
    console.log('🔢 Raw merged scores (before normalization):', mergedMap);
    
    return mergedMap;
}


/**
 * Build enhanced topic cumulative with raw scores and normalized weights
 */
buildEnhancedTopicCumulative(rawTopicMap) {
    const enhancedTopicCumulative = {};
    
    // Calculate total raw score for normalization
    const totalRawScore = Object.values(rawTopicMap).reduce((sum, score) => sum + score, 0);
    
    console.log('📊 Building enhanced topic cumulative:', {
        rawTopicMap,
        totalRawScore: this.roundToDecimal(totalRawScore, 6)
    });
    
    // Build enhanced structure for each topic
    Object.keys(rawTopicMap).forEach(topic => {
        const rawScore = rawTopicMap[topic];
        const normalizedWeight = totalRawScore > 0 ? rawScore / totalRawScore : 0;
        
        enhancedTopicCumulative[topic] = {
            rawScore: this.roundToDecimal(rawScore, 6),
            normalizedWeight: this.roundToDecimal(normalizedWeight, 6)
        };
    });
    
    // Verify the calculation
    const calculatedTotalWeight = Object.values(enhancedTopicCumulative)
        .reduce((sum, topic) => sum + topic.normalizedWeight, 0);
    
    console.log('✅ Enhanced topic cumulative verification:', {
        totalRawScore: this.roundToDecimal(totalRawScore, 6),
        calculatedTotalWeight: this.roundToDecimal(calculatedTotalWeight, 6),
        topics: Object.keys(enhancedTopicCumulative).length,
        sampleTopic: Object.keys(enhancedTopicCumulative)[0] ? 
            enhancedTopicCumulative[Object.keys(enhancedTopicCumulative)[0]] : 'none'
    });
    
    return enhancedTopicCumulative;
}

/**
 * Helper method to round numbers to specified decimal places
 */
roundToDecimal(number, decimals = 6) {
    if (number === 0 || !number) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(number * factor) / factor;
}
/**
 * Build topic map from URL behaviors with better debugging
 */
buildUrlTopicMap(urlBehaviors) {
    const topicMap = {};
    let processedBehaviors = 0;
    let skippedBehaviors = 0;
    
    urlBehaviors.forEach((behavior, index) => {
        // Skip behaviors without topic domains
        if (!behavior.topicDomains || 
            !Array.isArray(behavior.topicDomains) ||
            behavior.topicDomains.length === 0) {
            console.log(`⚠️ URL behavior ${index} skipped - no topic domains:`, {
                url: behavior.url,
                hasTopicDomains: !!behavior.topicDomains,
                topicDomainsLength: behavior.topicDomains?.length
            });
            skippedBehaviors++;
            return;
        }
        
        // Skip if engagement score is null/undefined
        if (behavior.engagementScore == null) {
            console.log(`⚠️ URL behavior ${index} skipped - no engagement score:`, behavior.url);
            skippedBehaviors++;
            return;
        }
        
        // Calculate URL engagement score (normalized 0-1) with null safety
        const engagementNorm = Math.max(0, Math.min(1, (behavior.engagementScore || 0) / 100));
        
        if (engagementNorm <= 0) {
            console.log(`⚠️ URL behavior ${index} skipped - zero engagement:`, {
                url: behavior.url,
                engagementScore: behavior.engagementScore,
                engagementNorm: engagementNorm
            });
            skippedBehaviors++;
            return;
        }
        
        console.log(`✅ Processing URL behavior ${index}:`, {
            url: behavior.url,
            engagementScore: behavior.engagementScore,
            engagementNorm: engagementNorm,
            topicDomains: behavior.topicDomains
        });
        
        // Distribute engagement score across topics
        let validTopics = 0;
        behavior.topicDomains.forEach(topicDomain => {
            // Skip invalid topic domains
            if (!topicDomain || 
                !topicDomain.topic || 
                topicDomain.weight == null ||
                topicDomain.weight <= 0) {
                console.log(`⚠️ Invalid topic domain in URL ${index}:`, topicDomain);
                return;
            }
            
            const topic = topicDomain.topic.trim();
            if (!topic) {
                console.log(`⚠️ Empty topic in URL ${index}:`, topicDomain);
                return;
            }
            
            const topicWeight = Math.max(0, Math.min(1, topicDomain.weight)); // Clamp between 0-1
            const wUrl = engagementNorm * topicWeight;
            
            topicMap[topic] = (topicMap[topic] || 0) + wUrl;
            validTopics++;
            
            console.log(`📊 URL topic contribution:`, {
                topic: topic,
                weight: topicWeight,
                engagementNorm: engagementNorm,
                contribution: wUrl,
                runningTotal: topicMap[topic]
            });
        });
        
        if (validTopics > 0) {
            processedBehaviors++;
        } else {
            console.log(`⚠️ URL behavior ${index} had no valid topics:`, behavior.url);
            skippedBehaviors++;
        }
    });
    
    console.log(`🌐 URL topic mapping summary:`, {
        total: urlBehaviors.length,
        processed: processedBehaviors,
        skipped: skippedBehaviors,
        topicsFound: Object.keys(topicMap).length,
        topicMap: topicMap
    });
    
    return topicMap;
}

/**
 * Merge search and URL topic maps with weighted combination
 */
mergeTopicMaps(searchTopicMap, urlTopicMap, searchWeight, urlWeight) {
    const mergedMap = {};
    const allTopics = new Set([
        ...Object.keys(searchTopicMap),
        ...Object.keys(urlTopicMap)
    ]);
    
    // If both maps are empty, return empty
    if (allTopics.size === 0) {
        return {};
    }
    
    allTopics.forEach(topic => {
        const searchScore = searchTopicMap[topic] || 0;
        const urlScore = urlTopicMap[topic] || 0;
        mergedMap[topic] = (searchScore * searchWeight) + (urlScore * urlWeight);
    });
    
    return this.normalizeTopicMap(mergedMap);
}

/**
 * Normalize topic map to probability distribution (sum = 1)
 */
normalizeTopicMap(topicMap) {
    const totalScore = Object.values(topicMap).reduce((sum, score) => sum + score, 0);
    
    if (totalScore === 0 || isNaN(totalScore)) {
        return {}; // Return empty if no valid scores
    }
    
    const normalizedMap = {};
    Object.keys(topicMap).forEach(topic => {
        const normalizedScore = topicMap[topic] / totalScore;
        // Only include topics with meaningful scores (> 0.01)
        if (normalizedScore >= 0.01) {
            normalizedMap[topic] = normalizedScore;
        }
    });
    
    // Re-normalize if we filtered out small scores
    const newTotal = Object.values(normalizedMap).reduce((sum, score) => sum + score, 0);
    if (newTotal > 0) {
        Object.keys(normalizedMap).forEach(topic => {
            normalizedMap[topic] = normalizedMap[topic] / newTotal;
        });
    }
    
    return normalizedMap;
}

/**
 * Calculate session duration from URL behaviors with proper error handling
 */
calculateSessionDurationFromBehaviors(urlBehaviors) {
    if (!urlBehaviors || urlBehaviors.length === 0) {
        return 1; // 1 minute fallback
    }
    
    // METHOD 1: Use activeTime (already in seconds in your database)
    const totalActiveSeconds = urlBehaviors.reduce((sum, behavior) => 
        sum + (behavior.activeTime || 0), 0);
    const sessionDurationFromActive = totalActiveSeconds / 60; // Convert seconds to minutes
    
    // METHOD 2: Use start/end times (these are ISO strings, not seconds)
    let sessionDurationFromTimestamps = 1;
    const validTimes = urlBehaviors
        .filter(behavior => behavior.startTime && behavior.endTime)
        .map(behavior => ({
            start: new Date(behavior.startTime), // This handles ISO strings correctly
            end: new Date(behavior.endTime)
        }))
        .filter(time => !isNaN(time.start.getTime()) && !isNaN(time.end.getTime()));

    if (validTimes.length > 0) {
        const minStart = new Date(Math.min(...validTimes.map(t => t.start.getTime())));
        const maxEnd = new Date(Math.max(...validTimes.map(t => t.end.getTime())));
        sessionDurationFromTimestamps = (maxEnd - minStart) / (1000 * 60); // ms to minutes (CORRECT for ISO dates)
    }
    
    // Use the larger duration
    const sessionDuration = Math.max(sessionDurationFromActive, sessionDurationFromTimestamps, 1);
    
    return sessionDuration;
}


/**
 * Update session metrics to use enhanced topic cumulative
 */
/**
 * Update session metrics to use enhanced topic cumulative and include intent focus
 */
calculateSessionMetrics(searches, urlBehaviors) {
    console.log('📊 Calculating session metrics');
    
    // Simple session duration from URL behaviors only
    const sessionDuration = this.calculateSessionDurationFromBehaviors(urlBehaviors);
    
    // Engagement confidence (independent of session duration)
    const engagementConfidence = this.calculateEngagementConfidence(searches, urlBehaviors);
    
    // Build temporary topic map for entropy calculation (use raw scores)
    const searchTopicMap = this.buildSearchTopicMap(searches);
    const urlTopicMap = this.buildUrlTopicMap(urlBehaviors);
    const rawTopicMap = this.mergeTopicMapsRaw(searchTopicMap, urlTopicMap, 0.4, 0.6);
    
    // For entropy calculation, we need normalized weights
    const normalizedTopicMap = this.normalizeTopicMap(rawTopicMap);
    const diversityEntropy = this.calculateDiversityEntropy(normalizedTopicMap);
    
    // Find dominant topic from normalized map
    const dominantTopic = this.findDominantTopic(normalizedTopicMap);
    
    // *** ADD INTENT FOCUS CALCULATION ***
    const intentData = this.calculateIntentFocus(searches);

    console.log('📊 Final session metrics:', {
        sessionLengthMin: sessionDuration.toFixed(2),
        engagementConfidence: engagementConfidence.toFixed(4),
        diversityEntropy: diversityEntropy.toFixed(4),
        dominantTopic: dominantTopic,
        dominantIntent: intentData.dominant_intent,
        intentScores: intentData.intent_scores
    });
    
    return {
        sessionLengthMin: sessionDuration,
        engagementConfidence: Math.max(0, Math.min(1, engagementConfidence)),
        diversityEntropy: Math.max(0, Math.min(1, diversityEntropy)),
        dominantTopic,
        
        // *** ADD THESE NEW FIELDS: ***
        dominant_intent: intentData.dominant_intent, 
        intent_scores: intentData.intent_scores 
    };
}
/**
 * Calculate engagement confidence score with robust session duration handling
 */
/**
 * Calculate engagement confidence score with robust session duration handling
 */
calculateEngagementConfidence(searches, urlBehaviors) {
    console.log('🎯 Calculating engagement confidence (FIXED)');
    
    let totalWeightedConfidence = 0;
    let totalWeight = 0;
    
    // Process URL behaviors - activeTime is in seconds
    urlBehaviors.forEach(behavior => {
        if (behavior.engagementScore == null) return;
        
        const confidence = Math.max(0, Math.min(1, (behavior.engagementScore || 0) / 100));
        const activeTimeMinutes = (behavior.activeTime || 0) / 60; // seconds to minutes
        
        if (activeTimeMinutes > 0 && confidence > 0) {
            totalWeightedConfidence += confidence * activeTimeMinutes;
            totalWeight += activeTimeMinutes;
        }
    });
    
    // Process searches
    searches.forEach(search => {
        if (search.processed && search.confidence != null && search.specificity != null) {
            const confidence = Math.max(0, Math.min(1, (search.specificity || 0) * (search.confidence || 0)));
            const searchTime = 0.5; // 30 seconds per search
            
            if (confidence > 0) {
                totalWeightedConfidence += confidence * searchTime;
                totalWeight += searchTime;
            }
        }
    });
    
    // Use weighted average instead of session duration division
    const result = totalWeight > 0 ? totalWeightedConfidence / totalWeight : 0;
    
    // ✅ REMOVED: The problematic console.log with sessionDuration
    console.log('🎯 Engagement confidence result:', {
        totalWeightedConfidence: totalWeightedConfidence.toFixed(4),
        totalWeight: totalWeight.toFixed(4),
        result: result.toFixed(4)
    });
    
    return Math.max(0, Math.min(1, result));
}

    /**
 * Validate profile structure before saving
 */
validateProfileStructure(profile) {
    // Check required fields
    if (!profile.userId) {
        profile.userId = 'default';
    }
    if (!profile.lastUpdated) {
        profile.lastUpdated = new Date().toISOString();
    }
    
    // Validate LTP structure if it exists
    if (profile.ltp) {
        const required = ['topic_cumulative', 'sessions_seen', 'ewma_focus', 'ewma_depth', 'confidence'];
        const missing = required.filter(field => profile.ltp[field] === undefined);
        
        if (missing.length > 0) {
            console.warn('🔄 LTP missing fields, resetting:', missing);
            profile.ltp = this.ltpBuilder.getEmptyLTP();
        }
        
        // Ensure numeric fields are valid numbers
        if (isNaN(profile.ltp.sessions_seen) || profile.ltp.sessions_seen < 0) {
            profile.ltp.sessions_seen = 0;
        }
        if (isNaN(profile.ltp.confidence) || profile.ltp.confidence < 0) {
            profile.ltp.confidence = 0;
        }
    }
    
    return true;
}
/**
 * Fallback engagement confidence when session duration is 0
 */
calculateFallbackEngagementConfidence(searches, urlBehaviors) {
    console.log('🔄 Using fallback engagement confidence calculation');
    
    let totalScore = 0;
    let itemCount = 0;
    
    // Process URL behaviors
    urlBehaviors.forEach(behavior => {
        if (behavior.engagementScore != null) {
            const confidence = (behavior.engagementScore || 0) / 100;
            totalScore += confidence;
            itemCount++;
            
            console.log('📊 Fallback URL score:', {
                url: behavior.url,
                engagementScore: behavior.engagementScore,
                confidence: confidence
            });
        }
    });
    
    // Process searches
    searches.forEach(search => {
        if (search.processed && search.confidence != null && search.specificity != null) {
            const confidence = (search.specificity || 0) * (search.confidence || 0);
            totalScore += confidence;
            itemCount++;
            
            console.log('🔍 Fallback search score:', {
                query: search.query,
                confidence: confidence
            });
        }
    });
    
    const result = itemCount > 0 ? totalScore / itemCount : 0;
    
    console.log('🔄 Fallback engagement confidence result:', {
        totalScore: totalScore,
        itemCount: itemCount,
        result: result
    });
    
    return Math.max(0, Math.min(1, result));
}

/**
 * Calculate URL active time in minutes with null safety
 */
calculateUrlActiveTime(behavior) {
    // Prefer explicit activeTime if available
    if (behavior.activeTime != null) {
        const timeInMinutes = behavior.activeTime / 60;
        return Math.max(0, timeInMinutes); // Ensure non-negative
    }
    
    // Fallback: calculate from start/end times
    try {
        if (!behavior.startTime || !behavior.endTime) return 0;
        
        const start = new Date(behavior.startTime);
        const end = new Date(behavior.endTime);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
        
        const durationMinutes = (end - start) / (1000 * 60);
        return Math.max(0, durationMinutes); // Ensure non-negative
    } catch (error) {
        return 0;
    }
}

/**
 * Calculate diversity entropy (normalized) with null safety
 */
calculateDiversityEntropy(topicCumulative) {
    const normalizedWeights = this.getNormalizedWeights(topicCumulative);
    const topics = Object.keys(normalizedWeights);
    const N = topics.length;
    
    if (N <= 1) return 0;
    
    // Calculate Shannon entropy
    let entropy = 0;
    topics.forEach(topic => {
        const p = normalizedWeights[topic];
        if (p > 0 && p <= 1) {
            entropy -= p * Math.log2(p);
        }
    });
    
    // Handle invalid entropy
    if (entropy <= 0 || isNaN(entropy)) return 0;
    
    // Calculate maximum possible entropy
    const maxEntropy = Math.log2(N);
    
    if (maxEntropy <= 0) return 0;
    
    // Normalize entropy and clamp between 0-1
    const normalizedEntropy = entropy / maxEntropy;
    return Math.max(0, Math.min(1, normalizedEntropy));
}

/**
 * Build and save STP for a completed session
 */
async buildAndSaveSTP(sessionId) {
    try {
        console.log(`🔨 Building and saving STP for completed session: ${sessionId}`);
        
        const stp = await this.buildSTP(sessionId);
        await this.saveSTPToProfile(stp);
        
        console.log('✅ STP saved to profile for session:', sessionId);
        return stp;
    } catch (error) {
        console.error('❌ Failed to build/save STP:', error);
        return null;
    }
}

/**
 * Save STP to user profile - FIXED VERSION
 */
async saveSTPToProfile(stpData) {
    await this.ensureInitialized();
    
    try {
        // Get profile with repair fallback
        let profile;
        try {
            profile = await this.getProfile();
        } catch (error) {
            console.warn('⚠️ Profile corrupted, repairing...');
          
            profile = await this.getProfile();
        }

        // Ensure profile has required structure
        if (!profile.userId) {
            profile.userId = 'default';
        }
        
        if (!profile.stpHistory) {
            profile.stpHistory = [];
        }

        // Initialize STP history if it doesn't exist
        if (!profile.stpHistory) {
            profile.stpHistory = [];
        }

        // Add new STP to history (limit to last 50 sessions)
        profile.stpHistory.unshift({
            ...stpData,
            saved_at: new Date().toISOString()
        });

        // Keep only last 50 STP records
        if (profile.stpHistory.length > 50) {
            profile.stpHistory = profile.stpHistory.slice(0, 50);
        }

        // Update last STP
        profile.lastSTP = stpData;
        profile.lastUpdated = new Date().toISOString();

        // Use put() with explicit key
        await this.db.profile.put(profile, 'default');
        
        console.log('💾 STP saved to profile:', {
            sessionId: stpData.session_id,
            topics: Object.keys(stpData.topic_cumulative).length,
            dominantTopic: stpData.dominant_topic
        });
        
        return { success: true };
    } catch (error) {
        console.error('❌ Failed to save STP to profile:', error);
        
        // Emergency repair and retry
       
        return { success: false, error: error.message };
    }
}

/**
 * Get STP history from profile
 */
async getSTPHistory(limit = 10) {
    const profile = await this.getProfile();
    return (profile.stpHistory || []).slice(0, limit);
}

/**
 * Get last STP from profile
 */
async getLastSTP() {
    const profile = await this.getProfile();
    return profile.lastSTP || null;
}
async aggregateDomainData(sessionId, domain, behaviors) {
    // Calculate aggregated metrics
    const urls = [...new Set(behaviors.map(b => b.url))];
    const startTime = behaviors.reduce((min, b) => 
        b.startTime < min ? b.startTime : min, behaviors[0].startTime);
    const endTime = behaviors.reduce((max, b) => 
        b.endTime > max ? b.endTime : max, behaviors[0].endTime);
    
    const totalActiveTime = behaviors.reduce((sum, b) => sum + (b.activeTime || 0), 0);
    const totalClicks = behaviors.reduce((sum, b) => sum + (b.clicks || 0), 0);
    const totalCopies = behaviors.reduce((sum, b) => sum + (b.copies || 0), 0);
    const totalPastes = behaviors.reduce((sum, b) => sum + (b.pastes || 0), 0);
    const totalHighlights = behaviors.reduce((sum, b) => sum + (b.highlights || 0), 0);
    const totalTabSwitches = behaviors.reduce((sum, b) => sum + (b.tabSwitches || 0), 0);
    
    const avgScrollDepth = behaviors.reduce((sum, b) => sum + (b.scrollDepth || 0), 0) / behaviors.length;
    const avgEngagementScore = behaviors.reduce((sum, b) => sum + (b.engagementScore || 0), 0) / behaviors.length;
 const topicDistribution = this.calculateTopicDistribution(behaviors);
    // Prepare domain behavior data
    const domainBehaviorData = {
        sessionId: sessionId,
        domain: domain,
        startTime: startTime,
        endTime: endTime,
        totalActiveTime: Math.round(totalActiveTime),
        urls: urls,
        totalClicks: totalClicks,
        totalCopies: totalCopies,
        totalPastes: totalPastes,
        totalHighlights: totalHighlights,
        totalTabSwitches: totalTabSwitches,
        avgScrollDepth: Math.round(avgScrollDepth),
        avgEngagementScore: Math.round(avgEngagementScore),
        topicDistribution: topicDistribution,
        lastUpdated: new Date().toISOString()
    };

    // Check if domain behavior record already exists
    const existingDomainRecord = await this.db.domainBehaviors
        .where('[sessionId+domain]')
        .equals([sessionId, domain])
        .first();

    if (existingDomainRecord) {
        // Update existing domain record
        await this.db.domainBehaviors.update(existingDomainRecord.id, domainBehaviorData);
    } else {
        // Insert new domain record
        await this.db.domainBehaviors.add(domainBehaviorData);
    }

    console.log('✅ Aggregated domain data:', {
        sessionId: sessionId,
        domain: domain,
        urlCount: urls.length,
        totalActiveTime: totalActiveTime,
        topicCount: Object.keys(topicDistribution).length
    });
}
   
calculateTopicDistribution(behaviors) {
  const topicWeights = {};
  
  behaviors.forEach(behavior => {
    if (behavior.topicDomains && Array.isArray(behavior.topicDomains)) {
      behavior.topicDomains.forEach(topicDomain => {
        if (topicDomain.topic && topicDomain.weight) {
          topicWeights[topicDomain.topic] = (topicWeights[topicDomain.topic] || 0) + topicDomain.weight;
        }
      });
    }
  });
  
  return topicWeights;
}
// In DatabaseService - updateTopicDomain method
async updateTopicDomains(recordId, topicDomains, queueTaskId = null) {
  try {
    // Prepare update data with weighted topics
    const updateData = {
      topicDomains: topicDomains, // Store the full weighted array
      topicInferenceSent: true,
      topicInferenceProcessing: false,
      lastUpdated: new Date().toISOString()
    };

    // Update the URL behavior record
    await this.db.urlBehaviors.update(recordId, updateData);

    // Remove task from AI queue if taskId provided
    if (queueTaskId) {
      await this.db.aiQueue.delete(queueTaskId);
      console.log('✅ Removed completed task from AI queue:', queueTaskId);
    }

    console.log('✅ Topic domains updated successfully with weights', {
      recordId,
      topicDomains,
      queueTaskId
    });

    return { success: true };

  } catch (error) {
    console.error('❌ Failed to update topic domains:', error);
    return { success: false, error: error.message };
  }
}
// ---------------------------------
// 🔹 AI Queue Management - CLEAN METHODS
// ---------------------------------

/**
 * Add task to AI queue
 */
async addToAIQueue(taskData) {
    await this.ensureInitialized();
 
    const aiTask = {
        type: taskData.type, // 'SEARCH_ENRICHMENT', 'PAGE_ANALYSIS', etc
        priority: taskData.priority || 2, // Default MEDIUM
        createdAt: new Date().toISOString(),
        processed: false,
        processedAt: null,
        data: taskData.data // Complete payload
    };
    
    const id = await this.db.aiQueue.add(aiTask);
    console.log('✅ Task queued for AI processing:', {
        id,
        type: taskData.type,
        priority: aiTask.priority
    });
    
    return id;
}

/**
 * Get pending AI tasks (higher priority first, then timestamp)
 */
async getPendingAITasks(limit = 5) {
  await this.ensureInitialized();
      
  try {
    const allPending = await this.db.aiQueue
      .filter(task => task.processed === false)
      .toArray();

    // Higher priority first (larger number = higher priority), then older createdAt first
    const sortedTasks = allPending.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // changed order
      }
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    return sortedTasks.slice(0, limit);
  } catch (error) {
    console.error('Error getting pending AI tasks:', error.message || error);
    return [];
  }
}


/**
 * Remove all AI queue tasks where data.query matches
 * @param {string} query - The query to match in task data
 */
// In databaseService.js - fix removeAITasksByQuery
async removeAITasksByQuery(query) {
  await this.ensureInitialized();
  try {
    // read all pending tasks then filter by nested data.query
    const allPending = await this.db.aiQueue
      .filter(task => task.processed === false)
      .toArray();

    const matchingTasks = allPending.filter(task =>
      task.data && task.data.query === query
    );

    for (const task of matchingTasks) {
      await this.db.aiQueue.delete(task.id);
    }

    console.log(`🧹 Removed ${matchingTasks.length} AI queue tasks for query:`, query);
    return { success: true, removedCount: matchingTasks.length };
  } catch (error) {
    console.error('❌ Failed to remove AI tasks by query:', error.message || error);
    return { success: false, error: error.message };
  }
}

/**
 * Get count of pending AI tasks
 */
async getPendingAITasksCount() {
  await this.ensureInitialized();
  try {
    const pendingTasks = await this.db.aiQueue
      .filter(task => task.processed === false)
      .count();
    console.log(`Pending tasks: ${pendingTasks}`);
    return pendingTasks;
  } catch (error) {
    console.error('Error counting pending AI tasks:', error.message || error);
    return 0;
  }
}



/**
 * Get URL behaviors by domain within a session
 */
async getUrlBehaviorsByDomain(sessionId, domain, limit = 50) {
    await this.ensureInitialized();
    return await this.db.urlBehaviors
        .where('[sessionId+domain]')
        .equals([sessionId, domain])
        .reverse()
        .limit(limit)
        .toArray();
}

/**
 * Get domain summary for a session with the new schema
 */
async getDomainSummary(sessionId) {
    await this.ensureInitialized();
    const domains = await this.db.domainBehaviors
        .where('sessionId')
        .equals(sessionId)
        .toArray();

    return domains.map(domain => ({
        domain: domain.domain,
        totalTime: domain.totalActiveTime || 0,
        visitCount: domain.urls ? domain.urls.length : 0,
        engagementScore: domain.avgEngagementScore || 0,
        totalClicks: domain.totalClicks || 0,
        totalHighlights: domain.totalHighlights || 0,
        avgScrollDepth: domain.avgScrollDepth || 0,
        urlCount: domain.urls ? domain.urls.length : 0,
        sessionDuration: this.calculateSessionDuration(domain.startTime, domain.endTime)
    }));
}

/**
 * Get detailed domain behavior for a specific domain
 */
async getDomainBehavior(sessionId, domain) {
    await this.ensureInitialized();
    return await this.db.domainBehaviors
        .where('[sessionId+domain]')
        .equals([sessionId, domain])
        .first();
}

/**
 * Get all unique domains for a session from URL behaviors
 */
async getSessionDomains(sessionId) {
    await this.ensureInitialized();
    const urlBehaviors = await this.getUrlBehaviors(sessionId, 1000);
    const domains = [...new Set(urlBehaviors.map(behavior => behavior.domain))];
    return domains;
}

/**
 * Calculate session duration in minutes
 */
/**
 * Calculate session duration in minutes (handles urlBehaviors or direct timestamps)
 */
calculateSessionDurationInMinutes(urlBehaviorsOrStart, endTime = null) {
    try {
        // Case 1: Passed array of URL behaviors
        if (Array.isArray(urlBehaviorsOrStart)) {
            const urlBehaviors = urlBehaviorsOrStart;
            if (!urlBehaviors || urlBehaviors.length === 0) return 0;

            // Use valid start/end times if available
            const validTimes = urlBehaviors
                .filter(b => b.startTime && b.endTime)
                .map(b => ({
                    start: new Date(b.startTime),
                    end: new Date(b.endTime)
                }))
                .filter(t => !isNaN(t.start.getTime()) && !isNaN(t.end.getTime()));

            if (validTimes.length > 0) {
                const minStart = new Date(Math.min(...validTimes.map(t => t.start.getTime())));
                const maxEnd = new Date(Math.max(...validTimes.map(t => t.end.getTime())));
                const durationMinutes = (maxEnd - minStart) / (1000 * 60);
                return Math.max(1, durationMinutes);
            }

            // Fallback: sum of activeTime (convert seconds → minutes)
            const totalActiveSeconds = urlBehaviors.reduce(
                (sum, b) => sum + (b.activeTime || 0),
                0
            );
            const durationMinutes = totalActiveSeconds / 60;
            return Math.max(1, durationMinutes);
        }

        // Case 2: Passed start and end times directly
        if (urlBehaviorsOrStart && endTime) {
            const start = new Date(urlBehaviorsOrStart);
            const end = new Date(endTime);
            return Math.max(0, (end - start) / (1000 * 60));
        }

        return 0;
    } catch (err) {
        console.warn('⚠️ Error calculating session duration in minutes:', err);
        return 0;
    }
}


/**
 * Get comprehensive session analytics
 */
async getSessionAnalytics(sessionId) {
    await this.ensureInitialized();
    
    const urlBehaviors = await this.getUrlBehaviors(sessionId, 1000);
    const domainSummary = await this.getDomainSummary(sessionId);

    // Calculate overall session metrics
    const totalActiveTime = urlBehaviors.reduce((sum, behavior) => sum + (behavior.activeTime || 0), 0);
    const totalClicks = urlBehaviors.reduce((sum, behavior) => sum + (behavior.clicks || 0), 0);
    const totalUrls = [...new Set(urlBehaviors.map(behavior => behavior.url))].length;
    
    const avgEngagementScore = domainSummary.length > 0 
        ? domainSummary.reduce((sum, domain) => sum + (domain.engagementScore || 0), 0) / domainSummary.length
        : 0;

    return {
        sessionId,
        totalDomains: domainSummary.length,
        totalUrls: totalUrls,
        totalActiveTime: Math.round(totalActiveTime),
        totalClicks: totalClicks,
        avgEngagementScore: Math.round(avgEngagementScore),
        domains: domainSummary,
        mostEngagedDomain: domainSummary.length > 0 
            ? domainSummary.reduce((max, domain) => 
                domain.engagementScore > max.engagementScore ? domain : max
              )
            : null,
        mostTimeSpentDomain: domainSummary.length > 0
            ? domainSummary.reduce((max, domain) => 
                domain.totalTime > max.totalTime ? domain : max
              )
            : null
    };
}

// 🔹 ADD THESE METHODS TO DatabaseService class

/**
 * Get recent searches with basic time filtering
 */
async getRecentSearches(limit = 50) {
    await this.ensureInitialized();
    return await this.db.searches
        .orderBy('timestamp')
        .reverse()
        .limit(limit)
        .toArray();
}

/**
 * Get domain summary for a session
 */
async getDomainSummary(sessionId) {
    await this.ensureInitialized();
    const domains = await this.db.domainBehaviors
        .where('sessionId')
        .equals(sessionId)
        .toArray();

    return domains.map(domain => ({
        domain: domain.domain,
        totalActiveTime: domain.totalActiveTime || 0,
        visitCount: domain.urls ? domain.urls.length : 0,
        engagementScore: domain.avgEngagementScore || 0,
        totalClicks: domain.totalClicks || 0,
        totalHighlights: domain.totalHighlights || 0,
        avgScrollDepth: domain.avgScrollDepth || 0,
        urlCount: domain.urls ? domain.urls.length : 0
    }));
}

/**
 * Get current active session
 */
async getCurrentSession() {
    await this.ensureInitialized();
    return await this.db.sessions.where('isActive').equals(1).first();
}



/**
 * Get recent snapshots
 */
async getRecentSnapshots(limit = 20) {
    await this.ensureInitialized();
    return await this.db.snapshots
        .orderBy('timestamp')
        .reverse()
        .limit(limit)
        .toArray();
}

    // ---------------------------------
    // 🔹 AI Queue Management
    // ---------------------------------
    async queueAIProcessing(task) {
        await this.ensureInitialized();
        const record = {
            type: task.type,
            searchId: task.searchId, // Store searchId reference
            query: task.query,
            priority: task.priority || 1,
            createdAt: new Date().toISOString(),
            processed: false,
            data: task.data || null
        };
        return await this.db.aiQueue.add(record);
    }



    // ---------------------------------
    // 🔹 Profile management
    // ---------------------------------
async getProfile() {
    await this.ensureInitialized();
    const profile = await this.db.profile.get('default');
    
    const currentProfile = profile || this.getDefaultProfile();
    
    // If lastSTP is null, return demo profile with populated data for UI
    if (currentProfile.lastSTP === null) {
        return {
            
            ...this.getDemoProfileData() // Add demo data for dashboard
            
        };
    }
    
    return currentProfile;
}

getDemoProfileData() {
    const now = new Date().toISOString();
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 172800000).toISOString();
    
    return {
        ltp: {
            topic_cumulative: {
               
                
            },
            sessions_seen: 0,
            ewma_focus: 0.5,
            ewma_depth: 0.5,
            intent_aggregate: {
                
            },
            last_updated: oneDayAgo,
            confidence: 0.4
        },
        stpHistory: [
            {
                sessionId: "demo_session_1",
                timestamp: oneDayAgo,
                topics: {
                    "artificial_intelligence": 0.91,
                    "neural_networks": 0.82,
                    "computer_vision": 0.76
                },
                focus_score: 0.78,
                depth_score: 0.72,
                primary_intent: "deep_research",
                duration: 1248000, // 20.8 minutes
                pagesVisited: 8
            },
            {
                sessionId: "demo_session_2",
                timestamp: twoDaysAgo,
                topics: {
                    "web_development": 0.87,
                    "javascript": 0.79,
                    "react_framework": 0.73
                },
                focus_score: 0.71,
                depth_score: 0.65,
                primary_intent: "learning",
                duration: 1560000, // 26 minutes
                pagesVisited: 12
            }
        ],
        lastSTP: {
            sessionId: "demo_current",
            timestamp: now,
            topics: {
               
            },
            focus_score: 0.5,
            depth_score: 0.5,
            primary_intent: "deep_research",
            duration: 960000, // 16 minutes
            pagesVisited: 1
        },
        profileSummary: {
            combinedSummary: "give generic summary.",
            ltpSummary: "General interest .",
            stpSummary: " typical browsing behavior.",
            confidence: 0.3,
            type: "general",
            version: "1.0",
            generatedAt: now
        },
        // Demo stats for dashboard
        demoStats: {
            totalSessions: 15,
            totalBrowsingTime: 6240000, // 104 minutes
            averageFocus: 0.75,
            topTopics: ["Artificial Intelligence", "Web Development", "Data Science"],
            preferredIntent: "Deep Research",
            engagementScore: 72
        }
    };
}


    async saveProfile(profile) {
        await this.ensureInitialized();
        profile.lastUpdated = new Date().toISOString();
        return await this.db.profile.put(profile);
    }

    async updateProfileStats(type) {
        await this.ensureInitialized();
        const profile = await this.getProfile();

        if (!profile.stats) {
            profile.stats = this.getDefaultStats();
        }

        switch (type) {
            case 'snapshot':
                profile.stats.totalSnapshots++;
                break;
            case 'search':
                profile.stats.totalSearches++;
                break;
            case 'browsing':
                profile.stats.totalBrowsingTime++;
                break;
        }

        return await this.saveProfile(profile);
    }

    // ---------------------------------
    // 🔹 Snapshot management
    // ---------------------------------
  

    async getRecentSnapshots(limit = 20) {
        await this.ensureInitialized();
        return await this.db.snapshots
            .orderBy('timestamp')
            .reverse()
            .limit(limit)
            .toArray();
    }

    // ---------------------------------
    // 🔹 Knowledge graph
    // ---------------------------------
    async updateKnowledgeGraph(entityData) {
        await this.ensureInitialized();
        return await this.db.knowledgeGraph.put(entityData);
    }

    async getKnowledgeGraphEntities(type = null) {
        await this.ensureInitialized();
        if (type) {
            return await this.db.knowledgeGraph.where('type').equals(type).toArray();
        }
        return await this.db.knowledgeGraph.toArray();
    }

    // ---------------------------------
    // 🔹 System state
    // ---------------------------------
    async getSystemState(key) {
        await this.ensureInitialized();
        const state = await this.db.systemState.get(key);
        return state ? state.value : null;
    }

    async setSystemState(key, value) {
        await this.ensureInitialized();
        return await this.db.systemState.put({
            key,
            value,
            lastUpdated: new Date().toISOString()
        });
    }

    // ---------------------------------
    // 🔹 Database maintenance
    // ---------------------------------
    async clearOldData(daysOld = 30) {
        await this.ensureInitialized();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
        const cutoffISO = cutoffDate.toISOString();

        try {
            // Clear old searches
            await this.db.searches
                .where('timestamp')
                .below(cutoffISO)
                .delete();

            // Clear old URL behaviors
            await this.db.urlBehaviors
                .where('lastUpdated')
                .below(cutoffISO)
                .delete();

            // Clear old domain behaviors
            await this.db.domainBehaviors
                .where('lastUpdated')
                .below(cutoffISO)
                .delete();

            // Clear old snapshots
            await this.db.snapshots
                .where('timestamp')
                .below(cutoffISO)
                .delete();

            // Clear processed AI tasks
            await this.db.aiQueue
                .where('processed')
                .equals(true)
                .delete();

            console.log(`🧹 Cleared data older than ${daysOld} days`);
        } catch (error) {
            console.error('Error clearing old data:', error);
        }
    }

    /**
     * Clear and recreate database (for development)
     */
    async clearDatabase() {
        try {
            if (this.db) {
                await this.db.delete();
                console.log('🗑️ Database cleared completely');
            }
        } catch (error) {
            console.error('Error clearing database:', error);
        }
        
        // Reset state
        this.db = null;
        this.isInitialized = false;
        
        // Reinitialize
        await this.initialize();
        console.log('✅ Database recreated with clean schema');
    }

    /**
     * Migrate existing behaviors data to new separate tables
     */
    async migrateToSeparateTables() {
        await this.ensureInitialized();
        
        try {
            console.log('🔄 Migrating behaviors to separate tables...');
            
            // Check if old behaviors table exists
            const tableNames = await this.db.tables.map(table => table.name);
            if (!tableNames.includes('behaviors')) {
                console.log('✅ No old behaviors table found, migration not needed');
                return;
            }
            
            const oldBehaviors = await this.db.behaviors.toArray();
            let migratedCount = 0;
            
            for (const oldRecord of oldBehaviors) {
                if (oldRecord.level === 'url') {
                    await this.saveUrlBehavior(oldRecord);
                } else if (oldRecord.level === 'domain') {
                    await this.saveDomainBehavior(oldRecord);
                }
                migratedCount++;
            }
            
            console.log(`✅ Migrated ${migratedCount} behavior records to separate tables`);
            
        } catch (error) {
            console.error('❌ Migration failed:', error);
            throw error;
        }
    }

    // ---------------------------------
    // 🔹 Helpers
    // ---------------------------------
    async ensureInitialized() {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

getDefaultProfile() {
    return {
        userId: 'default',
        ltp: {
            topic_cumulative: {},
            sessions_seen: 0,
            ewma_focus: 0.5,
            ewma_depth: 0.5,
            intent_aggregate: {},
            last_updated: null,
            confidence: 0
        },
        stpHistory: [],
        lastSTP: null,
        profileSummary: {
            combinedSummary: "New user - still learning preferences and behavior patterns.",
            ltpSummary: "Limited long-term data available.",
            stpSummary: "Current session data being collected.",
            confidence: 0.1,
            type: "default",
            version: "1.0",
            generatedAt: new Date().toISOString()
        },
        summaries: {
            ltpSummary: { summary: "LTP analysis pending." },
            stpSummary: { summary: "STP analysis pending." }
        },
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString()
    };
}
// You'll also need this helper method if it doesn't exist:


    getDefaultStats() {
        return {
            totalSnapshots: 0,
            totalBrowsingTime: 0,
            activeDays: 1,
            totalSearches: 0
        };
    }

    // Add these methods to DatabaseService class

/**
 * Get current LTP
 */
async getLTP() {
    if (!this.ltpBuilder) {
        await this.ensureInitialized();
    }
    return await this.ltpBuilder.getCurrentLTP();
}

/**
 * Get LTP summary for AI phrasing
 */
async getLTPSummary() {
    if (!this.ltpBuilder) {
        await this.ensureInitialized();
    }
    const ltp = await this.ltpBuilder.getCurrentLTP();
    return this.ltpBuilder.getLTPSummary(ltp);
}

/**
 * Manually trigger LTP update from STP (for testing)
 */
async updateLTPFromSTP(stpData) {
    if (!this.ltpBuilder) {
        await this.ensureInitialized();
    }
    return await this.ltpBuilder.buildLTP(stpData);
}

    // ---------------------------------
    // 🔹 Export/Import utilities
    // ---------------------------------
    async exportData() {
        await this.ensureInitialized();
        const data = {
            profile: await this.db.profile.toArray(),
            sessions: await this.db.sessions.toArray(),
            searches: await this.db.searches.toArray(),
            urlBehaviors: await this.db.urlBehaviors.toArray(),
            domainBehaviors: await this.db.domainBehaviors.toArray(),
            snapshots: await this.db.snapshots.toArray(),
            knowledgeGraph: await this.db.knowledgeGraph.toArray(),
            exportedAt: new Date().toISOString()
        };
        return JSON.stringify(data, null, 2);
    }

    async importData(jsonData) {
        await this.ensureInitialized();
        const data = JSON.parse(jsonData);
        
        // Clear existing data
        await this.db.profile.clear();
        await this.db.sessions.clear();
        await this.db.searches.clear();
        await this.db.urlBehaviors.clear();
        await this.db.domainBehaviors.clear();
        await this.db.snapshots.clear();
        await this.db.knowledgeGraph.clear();
        await this.db.aiQueue.clear();
        await this.db.systemState.clear();

        // Import new data
        if (data.profile) await this.db.profile.bulkAdd(data.profile);
        if (data.sessions) await this.db.sessions.bulkAdd(data.sessions);
        if (data.searches) await this.db.searches.bulkAdd(data.searches);
        if (data.urlBehaviors) await this.db.urlBehaviors.bulkAdd(data.urlBehaviors);
        if (data.domainBehaviors) await this.db.domainBehaviors.bulkAdd(data.domainBehaviors);
        if (data.snapshots) await this.db.snapshots.bulkAdd(data.snapshots);
        if (data.knowledgeGraph) await this.db.knowledgeGraph.bulkAdd(data.knowledgeGraph);

        console.log('📥 Data import completed');
    }
}

// Make available globally
if (typeof self !== 'undefined') {
    self.DatabaseService = DatabaseService;
}

if (typeof window !== 'undefined') {
    window.DatabaseService = DatabaseService;
}