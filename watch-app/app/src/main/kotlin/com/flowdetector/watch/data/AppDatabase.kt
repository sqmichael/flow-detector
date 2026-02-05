package com.flowdetector.watch.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Room database for local sensor data storage.
 *
 * Uses the singleton pattern to ensure only one database instance
 * exists throughout the app lifecycle.
 */
@Database(
    entities = [SensorBatch::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun sensorBatchDao(): SensorBatchDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        /**
         * Get the singleton database instance.
         * Creates the database on first access.
         */
        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { INSTANCE = it }
            }
        }

        private fun buildDatabase(context: Context): AppDatabase {
            return Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                "sensor_data.db"
            )
            .fallbackToDestructiveMigration()  // Simple migration for v1
            .build()
        }
    }
}
