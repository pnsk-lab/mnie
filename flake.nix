{
  description = "Mnie development and runtime helpers";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              docker
              docker-compose
              git
            ];
          };
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          composeUp = pkgs.writeShellApplication {
            name = "mnie-compose-up";
            runtimeInputs = [
              pkgs.docker-compose
            ];
            text = ''
              exec docker-compose up "$@"
            '';
          };
          nativeRun = pkgs.writeShellApplication {
            name = "mnie-native-run";
            runtimeInputs = [
              pkgs.bun
              pkgs.coreutils
            ];
            text = ''
              env_file="''${MNIE_ENV_FILE:-$PWD/.env}"
              data_dir="''${MNIE_DATA_DIR:-$PWD/data}"

              if [ ! -f "$env_file" ]; then
                echo "MNIE_ENV_FILE does not exist: $env_file" >&2
                exit 1
              fi

              mkdir -p "$data_dir"

              work_dir="$(mktemp -d)"
              trap 'rm -rf "$work_dir"' EXIT

              source_dir="$work_dir/source"
              mkdir -p "$source_dir"
              cp -R --no-preserve=mode,ownership "${self}/." "$source_dir"

              cd "$source_dir"
              bun install --frozen-lockfile --linker hoisted
              bun run sdk:build
              bun --filter @repo/mnie-app build

              export MNIE_DATABASE_PATH="''${MNIE_DATABASE_PATH:-$data_dir/mnie-app.sqlite}"
              exec bun --env-file="$env_file" apps/mnie-app/dist/index.js "$@"
            '';
          };
        in
        {
          default = {
            type = "app";
            program = "${composeUp}/bin/mnie-compose-up";
            meta.description = "Run Mnie with docker-compose";
          };

          compose-up = {
            type = "app";
            program = "${composeUp}/bin/mnie-compose-up";
            meta.description = "Run Mnie with docker-compose";
          };

          mnie = {
            type = "app";
            program = "${nativeRun}/bin/mnie-native-run";
            meta.description = "Build and run Mnie directly with Bun";
          };

        }
      );

      nixosModules.systemd =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.services.mnie;
          nativeRun = pkgs.writeShellApplication {
            name = "mnie-native-run";
            runtimeInputs = [
              pkgs.bun
              pkgs.coreutils
            ];
            text = ''
              env_file="''${MNIE_ENV_FILE:-$PWD/.env}"
              data_dir="''${MNIE_DATA_DIR:-$PWD/data}"

              if [ ! -f "$env_file" ]; then
                echo "MNIE_ENV_FILE does not exist: $env_file" >&2
                exit 1
              fi

              mkdir -p "$data_dir"

              work_dir="$(mktemp -d)"
              trap 'rm -rf "$work_dir"' EXIT

              source_dir="$work_dir/source"
              mkdir -p "$source_dir"
              cp -R --no-preserve=mode,ownership "${self}/." "$source_dir"

              cd "$source_dir"
              bun install --frozen-lockfile --linker hoisted
              bun run sdk:build
              bun --filter @repo/mnie-app build

              export MNIE_DATABASE_PATH="''${MNIE_DATABASE_PATH:-$data_dir/mnie-app.sqlite}"
              exec bun --env-file="$env_file" apps/mnie-app/dist/index.js "$@"
            '';
          };
        in
        {
          options.services.mnie = {
            enable = lib.mkEnableOption "Mnie";

            runtime = lib.mkOption {
              type = lib.types.enum [
                "docker"
                "native"
              ];
              default = "docker";
              description = "Runtime backend.";
            };

            image = lib.mkOption {
              type = lib.types.str;
              default = "ghcr.io/pnsk-lab/mnie:latest";
              description = "Container image to run when runtime is docker.";
            };

            envFile = lib.mkOption {
              type = lib.types.path;
              description = "Environment file passed to the container.";
            };

            dataDir = lib.mkOption {
              type = lib.types.str;
              default = "/var/lib/mnie-app";
              description = "Host directory mounted at /app/data.";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 18787;
              description = "Host port exposed for Mnie.";
            };
          };

          config = lib.mkIf cfg.enable (lib.mkMerge [
            {
              systemd.tmpfiles.rules = [
                "d ${cfg.dataDir} 0750 root root -"
              ];
            }

            (lib.mkIf (cfg.runtime == "docker") {
              virtualisation.oci-containers.backend = lib.mkDefault "docker";
              virtualisation.oci-containers.containers.mnie = {
                image = cfg.image;
                ports = [
                  "${toString cfg.port}:8787"
                ];
                environmentFiles = [
                  cfg.envFile
                ];
                volumes = [
                  "${cfg.dataDir}:/app/data"
                ];
              };
            })

            (lib.mkIf (cfg.runtime == "native") {
              systemd.services.mnie = {
                description = "Mnie";
                wantedBy = [
                  "multi-user.target"
                ];
                after = [
                  "network-online.target"
                ];
                wants = [
                  "network-online.target"
                ];
                environment = {
                  MNIE_ENV_FILE = toString cfg.envFile;
                  MNIE_DATA_DIR = cfg.dataDir;
                  PORT = toString cfg.port;
                };
                serviceConfig = {
                  Type = "simple";
                  Restart = "on-failure";
                  RestartSec = "5s";
                };
                script = ''
                  exec ${nativeRun}/bin/mnie-native-run
                '';
              };
            })
          ]);
        };

      nixosModules.default = self.nixosModules.systemd;
    };
}
