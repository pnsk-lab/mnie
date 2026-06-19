{
  description = "cSBI development and runtime helpers";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
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
        }
      );

      nixosModules.default =
        {
          config,
          lib,
          ...
        }:
        let
          cfg = config.services.csbie;
        in
        {
          options.services.csbie = {
            enable = lib.mkEnableOption "cSBI";

            image = lib.mkOption {
              type = lib.types.str;
              default = "git.yutakobayashi.com/nakasyou/csbi:latest";
              description = "Container image to run.";
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

          config = lib.mkIf cfg.enable {
            virtualisation.oci-containers.backend = lib.mkDefault "docker";

            systemd.tmpfiles.rules = [
              "d ${cfg.dataDir} 0750 root root -"
            ];

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
          };
        };
    };
}
