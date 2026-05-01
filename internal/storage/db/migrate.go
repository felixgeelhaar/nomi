package db

import (
	"embed"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/sqlite"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func (db *DB) migrator() (*migrate.Migrate, error) {
	sourceDriver, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("failed to create migration source: %w", err)
	}

	databaseDriver, err := sqlite.WithInstance(db.DB, &sqlite.Config{})
	if err != nil {
		return nil, fmt.Errorf("failed to create migration driver: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", sourceDriver, "sqlite", databaseDriver)
	if err != nil {
		return nil, fmt.Errorf("failed to create migrator: %w", err)
	}

	return m, nil
}

// Migrate runs all pending migrations from the embedded migration files.
func (db *DB) Migrate() error {
	m, err := db.migrator()
	if err != nil {
		return err
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	return nil
}

// MigrateDown rolls back all applied migrations.
func (db *DB) MigrateDown() error {
	m, err := db.migrator()
	if err != nil {
		return err
	}

	if err := m.Down(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("failed to run down migrations: %w", err)
	}

	return nil
}

// MigrateDownSteps rolls back the given number of migration steps.
func (db *DB) MigrateDownSteps(steps int) error {
	if steps <= 0 {
		return fmt.Errorf("steps must be > 0")
	}

	m, err := db.migrator()
	if err != nil {
		return err
	}

	if err := m.Steps(-steps); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("failed to run down migrations: %w", err)
	}

	return nil
}

// MigrateStatus returns the current migration status
func (db *DB) MigrateStatus() (version uint, dirty bool, err error) {
	m, err := db.migrator()
	if err != nil {
		return 0, false, err
	}

	version, dirty, err = m.Version()
	if err == migrate.ErrNilVersion {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("failed to get migration version: %w", err)
	}

	return version, dirty, nil
}
