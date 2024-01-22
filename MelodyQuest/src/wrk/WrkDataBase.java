/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package wrk;

import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 *
 * @author shine
 */
public class WrkDataBase {

    private Connection dbConnexion;

    public WrkDataBase() {

        dbConnexion = null;
    }

    public void dbConnecter() {

        try {
            dbConnexion = DriverManager.getConnection("jdbc:ucanaccess://" + "./data/mqdb.accdb");
            System.out.println("[LOG] - Connection DataBase OK");

        } catch (Exception e) {

            System.out.println("[Erreur] - Problème lors de la connection ACCESS");
            System.out.println(e.getMessage());

        }

    }

    public void dbDeconnecter() {
        System.out.println("[Log] - dbDeconnecter");

        try {
            dbConnexion.close();
            dbConnexion = null;

        } catch (Exception e) {

            System.out.println("[Erreur] - Problème lors de la deconnection");

        }

    }

    public boolean dbEstConnectee() {
        System.out.println("[Log] - dbEstConnectee");
        boolean retour = false;
        try {

            retour = !dbConnexion.isClosed();

        } catch (Exception e) {

            System.out.println("[Erreur] - Problème lors de la vérifition de la liaison");

        }
        System.out.println("[Information] - Est connectée: " + retour);
        return retour;
    }

    /*
    public List<Personne> dbLirePersonnes() throws DBException {
        System.out.println("[Log] - dbLirePersonnes");
        List<Personne> maListe = new ArrayList<Personne>();

        try (Statement st = dbConnexion.createStatement(); //st.executeQuery("select * from t_eleve");
                 ResultSet rs = st.executeQuery("select NOM, PRENOM from t_personne ");)//mieux
        {

            while (rs.next()) {

                maListe.add(new Personne(rs.getString("NOM"), rs.getString("PRENOM")));
            }

        } catch (SQLException ex) {

            System.out.println("[Erreur] - Problème lors de la lecture des données");

        }

        return maListe;
        }

    }
     */
}
