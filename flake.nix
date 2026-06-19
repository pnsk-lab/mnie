{
  description = "cSBI development and runtime helpers";

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
            name = "csbi-compose-up";
            runtimeInputs = [
              pkgs.docker-compose
            ];
            text = ''
              exec docker-compose up "$@"
            '';
          };
          nativeRun = pkgs.writeShellApplication {
            name = "csbi-native-run";
            runtimeInputs = [
              pkgs.bun
              pkgs.coreutils
            ];
            text = ''
              env_file="''${CSBIE_ENV_FILE:-$PWD/.env}"
              data_dir="''${CSBIE_DATA_DIR:-$PWD/data}"

              if [ ! -f "$env_file" ]; then
                echo "CSBIE_ENV_FILE does not exist: $env_file" >&2
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
              bun --filter @repo/csbie build

              export CSBIE_DATABASE_PATH="''${CSBIE_DATABASE_PATH:-$data_dir/csbie.sqlite}"
              exec bun --env-file="$env_file" apps/csbie/dist/index.js "$@"
            '';
          };
        in
        {
          default = {
            type = "app";
            program = "${composeUp}/bin/csbi-compose-up";
            meta.description = "Run cSBI with docker-compose";
          };

          compose-up = {
            type = "app";
            program = "${composeUp}/bin/csbi-compose-up";
            meta.description = "Run cSBI with docker-compose";
          };

          csbie = {
            type = "app";
            program = "${nativeRun}/bin/csbi-native-run";
            meta.description = "Build and run cSBI directly with Bun";
          };

        }
      );

      nixosModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.services.csbie;
          nativeRun = pkgs.writeShellApplication {
            name = "csbi-native-run";
            runtimeInputs = [
              pkgs.bun
              pkgs.coreutils
            ];
            text = ''
              env_file="''${CSBIE_ENV_FILE:-$PWD/.env}"
              data_dir="''${CSBIE_DATA_DIR:-$PWD/data}"

              if [ ! -f "$env_file" ]; then
                echo "CSBIE_ENV_FILE does not exist: $env_file" >&2
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
              bun --filter @repo/csbie build

              export CSBIE_DATABASE_PATH="''${CSBIE_DATABASE_PATH:-$data_dir/csbie.sqlite}"
              exec bun --env-file="$env_file" apps/csbie/dist/index.js "$@"
            '';
          };
        in
        {
          options.services.csbie = {
            enable = lib.mkEnableOption "cSBI";

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
              default = "git.yutakobayashi.com/nakasyou/csbi:latest";
              description = "Container image to run when runtime is docker.";
            };

            envFile = lib.mkOption {
              type = lib.types.path;
              description = "Environment file passed to the container.";
            };

            dataDir = lib.mkOption {
              type = lib.types.str;
              default = "/var/lib/csbie";
              description = "Host directory mounted at /app/data.";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 18787;
              description = "Host port exposed for cSBI.";
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
              virtualisation.oci-containers.containers.csbie = {
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
              systemd.services.csbie = {
                description = "cSBI";
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
                  CSBIE_ENV_FILE = toString cfg.envFile;
                  CSBIE_DATA_DIR = cfg.dataDir;
                  PORT = toString cfg.port;
                };
                serviceConfig = {
                  Type = "simple";
                  Restart = "on-failure";
                  RestartSec = "5s";
                };
                script = ''
                  exec ${nativeRun}/bin/csbi-native-run
                '';
              };
            })
          ]);
        };
    };
}
