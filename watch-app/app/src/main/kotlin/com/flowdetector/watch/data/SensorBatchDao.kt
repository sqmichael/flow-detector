package com.flowdetector.watch.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

/**
 * Data Access Object for sensor batch operations.
 *
 * Provides methods to insert new batches, retrieve unsynced batches
 * for upload, mark batches as synced, and clean up old data.
 */
@Dao
interface SensorBatchDao {

    /**
     * Insert a new sensor batch into the database.
     * @return The auto-generated ID of the inserted batch
     */
    @Insert
    suspend fun insert(batch: SensorBatch): Long

    /**
     * Get all unsynced batches ordered by timestamp (oldest first).
     * This ensures batches are synced in chronological order.
     */
    @Query("SELECT * FROM sensor_batches WHERE synced = 0 ORDER BY timestamp ASC")
    suspend fun getUnsynced(): List<SensorBatch>

    /**
     * Get count of unsynced batches (for UI display).
     */
    @Query("SELECT COUNT(*) FROM sensor_batches WHERE synced = 0")
    suspend fun getUnsyncedCount(): Int

    /**
     * Mark specific batches as synced after successful upload.
     * @param ids List of batch IDs that were successfully synced
     */
    @Query("UPDATE sensor_batches SET synced = 1 WHERE id IN (:ids)")
    suspend fun markSynced(ids: List<Long>)

    /**
     * Delete old synced batches to free up storage.
     * Only deletes batches that have been successfully synced.
     * @param before Timestamp threshold - delete synced batches older than this
     */
    @Query("DELETE FROM sensor_batches WHERE synced = 1 AND timestamp < :before")
    suspend fun deleteOldSynced(before: Long)

    /**
     * Get total count of all batches (for debugging).
     */
    @Query("SELECT COUNT(*) FROM sensor_batches")
    suspend fun getTotalCount(): Int
}
